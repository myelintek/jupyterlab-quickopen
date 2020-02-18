import os
import time
import re
from fnmatch import fnmatch, fnmatchcase

from notebook.base.handlers import APIHandler
from tornado import web
from tornado.log import app_log
from tornado.escape import json_encode


class QuickOpenHandler(APIHandler):
    def __init__(self, *args, **kwargs):
        super(QuickOpenHandler, self).__init__(*args, **kwargs)

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

    def isSubSeq(self, str1, str2):
        m = len(str1)
        n = len(str2)
        j = 0
        i = 0
        while j<m and i<n:
            if str1[j] == str2[i]:
                j=j+1
            i=i+1
        return j==m

    def scan_disk(self, path, excludes, exclude_paths, max_load, re_pattern=None, on_disk=None, count=None):
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
                self.scan_disk(entry.path, excludes, exclude_paths, max_load, re_pattern, on_disk, count)
            elif entry.is_file():
                if re_pattern:
                    #if not re_pattern.match(entry.path):
                    if not self.isSubSeq(re_pattern.lower(), entry.path.lower()):
                        continue
                print(entry.path)
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
        keyword = self.get_argument('keyword')

        if not max_load: 
            max_load = 10000

        start_ts = time.time()
        if current_path:
            full_path = os.path.join(self.root_dir, current_path)
        else:
            full_path = self.root_dir
        if keyword:
            #pattern = '\S*?' + '\S*?'.join(re.escape(w) for w in keyword if w != ' ') + '\S*?'
            pattern = ''.join(w for w in keyword if w != ' ')
            print(pattern)
            #re_pattern = re.compile(pattern)
            re_pattern = pattern
            contents_by_path = self.scan_disk(full_path, excludes, exclude_paths, max_load, re_pattern)
        else:
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
