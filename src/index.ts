import { ILabShell, JupyterFrontEnd, JupyterFrontEndPlugin } from "@jupyterlab/application";
import { ICommandPalette } from "@jupyterlab/apputils";
import { ISettingRegistry, URLExt, PathExt } from "@jupyterlab/coreutils";
import { IDocumentManager } from "@jupyterlab/docmanager";
import { ServerConnection } from "@jupyterlab/services";
import { FileBrowser, IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { CommandRegistry } from "@phosphor/commands";
import { ReadonlyJSONObject } from "@phosphor/coreutils";
import { Message } from "@phosphor/messaging";
import { ISignal, Signal } from "@phosphor/signaling";
import { CommandPalette } from "@phosphor/widgets";
import "../style/index.css";

/** Structure of the JSON response from the server */
interface QuickOpenResponse {
  readonly contents: { [key: string]: string[] };
  readonly scanSeconds: number;
}

async function sleep(ms = 0) {
  return new Promise(r => setTimeout(r, ms));
}

/** Makes a HTTP request for the server-side quick open scan */
async function fetchContents(path: string, excludes: string[], exclude_paths:string[], max_load: number, keyword: string): Promise<QuickOpenResponse> {
  const query = excludes
    .map(exclude => {
      return "excludes=" + encodeURIComponent(exclude);
    })
    .join("&");
  const query_2 = exclude_paths
    .map(exclude_path => {
      return "exclude_paths=" + encodeURIComponent(exclude_path);
    })
    .join("&");

  const settings = ServerConnection.makeSettings();
  const fullUrl = URLExt.join(settings.baseUrl, "/api/quickopen") + "?" + query + "&" + query_2 + "&path=" + path + "&max_load=" + max_load + "&keyword=" + encodeURIComponent(keyword);
  const response = await ServerConnection.makeRequest(fullUrl, { method: "GET" }, settings);
  if (response.status !== 200) {
    throw new ServerConnection.ResponseError(response);
  }
  return await response.json();
}

/**
 * Shows files nested under directories in the root notebooks directory
 * configured on the server.
 */
class QuickOpenWidget extends CommandPalette {
  private _pathSelected = new Signal<this, string>(this);
  private _settings: ReadonlyJSONObject;
  private last_keyword: string;
  private update_time: number;
  private _fileBrowser: FileBrowser;

  constructor(factory: IFileBrowserFactory, options: CommandPalette.IOptions) {
    super(options);

    this.id = "jupyterlab-quickopen";
    this.title.iconClass = "jp-SideBar-tabIcon jp-SearchIcon";
    this.title.caption = "Quick Open";

    this._fileBrowser = factory.defaultBrowser;
    this.update_time = Date.now();
    this.last_keyword = ''
  }

  /** Signal when a selected path is activated. */
  get pathSelected(): ISignal<this, string> {
    return this._pathSelected;
  }

  /** Current extension settings */
  set settings(settings: ReadonlyJSONObject) {
    this._settings = settings;
  }

  /**
   * Refreshes the widget with the paths of files on the server.
   */
  protected async onActivateRequest(msg: Message) {
    super.onActivateRequest(msg);

    // Fetch the current contents from the server
    let path = this._settings.relativeSearch ? this._fileBrowser.model.path : "";
    let response = await fetchContents(path, <string[]>this._settings.excludes, <string[]>this._settings.exclude_paths, <number>this._settings.max_load, this.inputNode.value);

    // Remove all paths from the view
    this.clearItems();

    for (let category in response.contents) {
      for (let fn of response.contents[category]) {
        // Creates commands that are relative file paths on the server
        let command = `${category}/${fn}`;
        if (!this.commands.hasCommand(command)) {
          // Only add the command to the registry if it does not yet exist
          // TODO: Track disposables and remove
          this.commands.addCommand(command, {
            label: fn,
            execute: () => {
              // Emit a selection signal
              this._pathSelected.emit(command);
            }
          });
        }
        // Make the file visible under its parent directory heading
        this.addItem({ command, category });
      }
    }
    super.onUpdateRequest(msg)
  }

  protected async onUpdateRequest(msg: Message) {
    // Fetch the current contents from the server
    if(Date.now() - this.update_time < 2000 || this.last_keyword == this.inputNode.value){
      await sleep(1000);
      this.onUpdateRequest(msg)
      return
    }
    else{
      let my_keyword = this.inputNode.value
      await sleep(1000);
      if(my_keyword != this.inputNode.value){return;}
      this.update_time = Date.now(); this.last_keyword = this.inputNode.value;
    }

    let path = this._settings.relativeSearch ? this._fileBrowser.model.path : "";
    let response = await fetchContents(path, <string[]>this._settings.excludes, <string[]>this._settings.exclude_paths, <number>this._settings.max_load, this.inputNode.value);

    // Remove all paths from the view
    this.clearItems();

    for (let category in response.contents) {
      for (let fn of response.contents[category]) {
        // Creates commands that are relative file paths on the server
        let command = `${category}/${fn}`;
        if (!this.commands.hasCommand(command)) {
          // Only add the command to the registry if it does not yet exist
          // TODO: Track disposables and remove
          this.commands.addCommand(command, {
            label: fn,
            execute: () => {
              // Emit a selection signal
              this._pathSelected.emit(command);
            }
          });
        }
        // Make the file visible under its parent directory heading
        this.addItem({ command, category });
      }
    }
    super.onUpdateRequest(msg)
  }

}

/**
 * Initialization data for the jupyterlab-quickopen extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: "@parente/jupyterlab-quickopen:plugin",
  autoStart: true,
  requires: [ICommandPalette, IDocumentManager, ILabShell, ISettingRegistry, IFileBrowserFactory],
  activate: async (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    docManager: IDocumentManager,
    labShell: ILabShell,
    settingRegistry: ISettingRegistry,
    fileBrowserFactory: IFileBrowserFactory
  ) => {
    window["docManager"] = docManager;

    console.log(`Activated extension: ${extension.id}`);
    const commands: CommandRegistry = new CommandRegistry();
    const widget: QuickOpenWidget = new QuickOpenWidget(fileBrowserFactory, { commands });
    const settings: ISettingRegistry.ISettings = await settingRegistry.load(extension.id);

    // Listen for path selection signals and show the selected files in the
    // appropriate editor/viewer
    widget.pathSelected.connect((sender: QuickOpenWidget, path: string) => {
      labShell.collapseLeft();
      docManager.openOrReveal(PathExt.normalize(path));
    });

    // Listen for setting changes and apply them to the widget
    widget.settings = settings.composite;
    settings.changed.connect((settings: ISettingRegistry.ISettings) => {
      widget.settings = settings.composite;
    });

    // Add a command to activate the quickopen sidebar so that the user can
    // find it in the command palette, assign a hotkey, etc.
    const command: string = "quickopen:activate";
    app.commands.addCommand(command, {
      label: "Quick Open",
      execute: () => {
        labShell.activateById(widget.id);
      }
    });
    palette.addItem({ command, category: "File Operations" });

    // Add the quickopen widget as a left sidebar
    labShell.add(widget, "left", { rank: 1000 });
  }
};

export default extension;
