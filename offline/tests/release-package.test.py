import importlib.util
import json
import os
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[1]/"tools"/"build-release.py"
SPEC=importlib.util.spec_from_file_location("offline_release_builder",SCRIPT)
BUILDER=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)

def write_png(path:Path,width:int,height:int)->None:
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n"+struct.pack(">I",13)+b"IHDR"+struct.pack(">II",width,height)+b"\x08\x06\x00\x00\x00")

def make_fixture(root:Path)->None:
    files={
      "offline/character/ui/index.html":'<meta name="viewport" content="width=device-width">',
      "offline/character/ui/styles.css":"body { color: white; }",
      "offline/character/ui/backup.css":".backup { display: block; }",
      "offline/character/ui/app.js":"console.log('offline');",
      "offline/game/index.html":"<main>game</main>",
      "offline/game/screen.css":"main { display: block; }",
      "offline/game/main.js":"console.log('game');",
      "offline/storage/indexeddb.js":"export class DB {}",
      "offline/storage/backup.js":"export function backup() {}",
      "offline/service-worker.js":'const PRECACHE_ASSETS = ["./character/ui/index.html", "./game/index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];',
    }
    for rel,content in files.items():
        target=root/rel
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(content,encoding="utf-8")
    manifest={"scope":"./","start_url":"./character/ui/index.html","icons":[
      {"src":"./icons/icon-192.png","sizes":"192x192"},
      {"src":"./icons/icon-512.png","sizes":"512x512"}]}
    target=root/"offline/manifest.webmanifest"
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(manifest),encoding="utf-8")
    write_png(root/"offline/icons/icon-192.png",192,192)
    write_png(root/"offline/icons/icon-512.png",512,512)
    (root/"server.js").write_text("must not ship",encoding="utf-8")
    (root/"local_accounts.json").write_text('{"password":"not-for-release"}',encoding="utf-8")
    test_dir=root/"offline/tests"
    test_dir.mkdir(parents=True,exist_ok=True)
    (test_dir/"fixture.test.js").write_text("test fixture only",encoding="utf-8")

class OfflineReleasePackageTests(unittest.TestCase):
    def test_zip_contains_only_allowlisted_runtime_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            make_fixture(root)
            output=root/"dist"/"release.zip"
            result=BUILDER.build_release(root,output)
            self.assertTrue(output.is_file())
            self.assertGreater(result["files"],0)
            with zipfile.ZipFile(output) as archive:
                names=set(archive.namelist())
                self.assertIn("offline/character/ui/index.html",names)
                self.assertIn("offline/manifest.webmanifest",names)
                self.assertIn("offline/RELEASE-MANIFEST.json",names)
                self.assertNotIn("server.js",names)
                self.assertNotIn("local_accounts.json",names)
                self.assertFalse(any("/tests/" in name for name in names))
                self.assertFalse(any(name.endswith("README.md") for name in names))
                manifest=json.loads(archive.read("offline/RELEASE-MANIFEST.json"))
                self.assertEqual(manifest["schemaVersion"],1)
                self.assertEqual(len(manifest["files"]),result["files"])
                self.assertTrue(all(len(item["sha256"])==64 for item in manifest["files"]))
                self.assertEqual(manifest["commit"], os.environ.get("GITHUB_SHA") or None)

    def test_refuses_external_urls_and_hardcoded_secrets(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            make_fixture(root)
            source=root/"offline/character/ui/app.js"
            source.write_text('const apiKey = "fixture-secret-that-must-never-ship";',encoding="utf-8")
            with self.assertRaises(BUILDER.ReleaseBuildError):
                BUILDER.collect_release_files(root)
            source.write_text('const help = "https://example.invalid";',encoding="utf-8")
            with self.assertRaises(BUILDER.ReleaseBuildError):
                BUILDER.collect_release_files(root)

    def test_refuses_missing_precache_assets_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            make_fixture(root)
            (root/"offline/service-worker.js").write_text('const PRECACHE_ASSETS = ["./missing.js"];',encoding="utf-8")
            with self.assertRaises(BUILDER.ReleaseBuildError):
                BUILDER.collect_release_files(root)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            make_fixture(root)
            outside=root/"outside.js"
            outside.write_text("outside",encoding="utf-8")
            (root/"offline/character/ui/linked.js").symlink_to(outside)
            with self.assertRaises(BUILDER.ReleaseBuildError):
                BUILDER.collect_release_files(root)

if __name__=="__main__":
    unittest.main(verbosity=2)
