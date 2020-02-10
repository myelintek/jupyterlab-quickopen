import os
import time

from fnmatch import fnmatch, fnmatchcase

from notebook.base.handlers import APIHandler
from tornado import web
from tornado.log import app_log
from tornado.escape import json_encode


class QuickOpenHandler(APIHandler):
    @property
    def contents_manager(self):
        """Currently configured notebook server ContentsManager."""
        return self.settings['contents_manager']

    @property
    def root_dir(self):
        """Root directory to scan."""
        return self.contents_manager.root_dir

    def should_hide(self, entry, excludes):
        """Decides if a file or directory should be hidden from the search results based on
        the `allow_hidden` and `hide_globs` properties of the ContentsManager, as well as a
        set of exclude patterns included in the client request.

        Parameters
        ----------
        entry: DirEntry
            From os.scandir
        excludes: set of str
            Exclude patterns

        Returns
        -------
        bool
        """
        return (
            any(fnmatch(entry.name, glob) for glob in excludes) or
            not self.contents_manager.should_list(entry.name) or
            (self.contents_manager.is_hidden(entry.path) and not self.contents_manager.allow_hidden)
        )

    def scan_disk(self, path, excludes, exclude_paths, max_load, on_disk=None, count=None):
        if on_disk is None:
            on_disk = {}
        if count is None:
            count = {'num': 0}
        if path in exclude_paths:
            return on_disk
        for entry in os.scandir(path):
            if count['num'] >= max_load:
                break
            if self.should_hide(entry, excludes):
                continue
            elif entry.is_dir():
                self.scan_disk(entry.path, excludes, exclude_paths, max_load, on_disk, count)
            elif entry.is_file():
                parent = os.path.relpath(os.path.dirname(entry.path), self.root_dir)
                on_disk.setdefault(parent, []).append(entry.name)
                count['num'] += 1
        return on_disk

    @web.authenticated
    def get(self):
        """Gets the name of every file under the root notebooks directory binned by parent
        folder relative to the root notebooks dir.

        Arguments
        ---------
        exclude: str
            Comma-separated set of file name patterns to exclude

        Responds
        --------
        JSON
            scan_seconds: Time in seconds to collect all file names
            contents: File names binned by parent directory
        """
        excludes = set(self.get_arguments('excludes'))
        exclude_paths = set(self.get_arguments('exclude_paths'))
        current_path = self.get_argument('path')
        max_load = int(self.get_argument('max_load'))
        if not max_load: max_load = 1000
        start_ts = time.time()
        if current_path:
            full_path = os.path.join(self.root_dir, current_path)
        else:
            full_path = self.root_dir
        contents_by_path = self.scan_disk(full_path, excludes, exclude_paths, max_load)

        #def get_sum(dt):
        #    s = 0
        #    for i in dt.values():
        #        if isinstance(i, list):
        #            s+=len(i)
        #        else :
        #            s+=1
        #    return s

        #print(max_load)
        #print(get_sum(contents_by_path))

        delta_ts = time.time() - start_ts
        self.write(json_encode({
            'scan_seconds': delta_ts,
            'contents': contents_by_path
        }))
