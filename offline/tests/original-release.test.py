#!/usr/bin/env python3
"""Contract tests for building a safe release from the original Cocos client."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

BUILDER = Path(__file__).resolve().parents[1] / "tools" / "build-original-game-release.py"


def make_fixture(root: Path) -> None:
    files = {
        "client/index.html": '<!doctype html><script src="./index.1d55c.js"></script>',
        "client/index.1d55c.js": 'System.import("./application.23610.js");',
        "client/application.23610.js": "window.__cocosApplication = true;",
        "client/src/polyfills.bundle.5adbf.js": "/* polyfills */",
        "client/src/system.bundle.543e6.js": "/* systemjs */",
        "client/src/import-map.4e643.json": '{"imports":{"cc":"./cocos-js/cc.js"}}',
        "client/src/settings.57846.json": json.dumps({
            "CocosEngine": "3.8.8",
            "assets": {"server": "", "preloadBundles": [{"bundle": "resources"}, {"bundle": "main"}]},
            "plugins": {"jsList": ["assets/scripts/net/goline-adapter.8231b.js"]},
            "launch": {"launchScene": "db://assets/main.scene"},
        }),
        "client/cocos-js/cc.js": "/* cocos runtime fixture */",
        "client/assets/main/config.3e757.json": '{"import":[],"native":[]}',
        "client/assets/main/index.3e757.js": "/* main game bundle fixture */",
        "client/assets/resources/config.caeb6.json": '{"import":[],"native":[]}',
        "client/assets/resources/index.caeb6.js": "/* resources bundle fixture */",
        "client/assets/internal/config.9e58a.json": '{"import":[],"native":[]}',
        "client/assets/scripts/net/goline-adapter.8231b.js": "/* original network adapter fixture */",
        "client/assets-packs/tiles.pack": "tile-pack-fixture",
        "client/assets-packs/tiles.index.json": '{"tile.png":[0,10]}',
        "client/assets-packs/packs-manifest.json": json.dumps({
            "groups": [{
                "group": "tile",
                "file": "tiles.pack",
                "index": "tiles.index.json",
                "size": 17,
            }],
            "enc": False,
        }),
        "client/pwa/manifest.json": json.dumps({
            "name": "小樹",
            "start_url": "./",
            "scope": "./",
            "display": "standalone",
            "icons": [{"src": "./icon-180.png", "sizes": "180x180", "type": "image/png"}],
        }),
        "client/pwa/icon-180.png": "png-fixture",
        "extracted_data/gamedata.json": json.dumps({
            "maps": {"training": ["orc"]},
            "mobs": {"orc": {"n": "妖魔", "hp": 100}},
            "items": {},
            "skills": {},
        }, ensure_ascii=False),
        "extracted_data/npcs.json": '[{"id":"npc_test","n":"測試 NPC"}]',
        "extracted_data/npchtml.json": '{"pages":{}}',
        "extracted_data/castles.json": "[]",
        "offline/original/local-goline-bridge.js": "/* local bridge fixture */",
        "server.js": "must never be published",
        "local_accounts.json": '{"password":"must-never-be-published"}',
        "node_modules/fake/index.js": "must never be published",
        "tools/goline.proto": "must never be published",
        "backup/pre-security-cleanup.txt": "must never be published",
    }
    for relative, value in files.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(value, str):
            target.write_text(value, encoding="utf-8")


def run_builder(root: Path, output: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(BUILDER),
            "--root",
            str(root),
            "--output",
            str(output),
        ],
        text=True,
        capture_output=True,
        check=False,
    )


class OriginalCocosReleaseTests(unittest.TestCase):
    def test_release_contains_original_cocos_entry_and_runtime_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_fixture(root)
            archive_path = root / "dist" / "original-game.zip"

            result = run_builder(root, archive_path)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(archive_path.is_file())
            with zipfile.ZipFile(archive_path) as archive:
                names = set(archive.namelist())
                self.assertIn("site/index.html", names)
                self.assertIn("site/index.1d55c.js", names)
                self.assertIn("site/application.23610.js", names)
                self.assertIn("site/src/settings.57846.json", names)
                self.assertIn("site/cocos-js/cc.js", names)
                self.assertIn("site/assets/main/index.3e757.js", names)
                self.assertIn("site/assets-packs/tiles.pack", names)
                self.assertIn("site/assets-packs/tiles.index.json", names)
                self.assertIn("site/gamedata.json", names)
                self.assertIn("site/npcs.json", names)
                self.assertIn("site/npchtml.json", names)
                self.assertIn("site/offline/original/local-goline-bridge.js", names)

    def test_release_excludes_server_accounts_dependencies_and_backups(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_fixture(root)
            archive_path = root / "dist" / "original-game.zip"

            result = run_builder(root, archive_path)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with zipfile.ZipFile(archive_path) as archive:
                names = set(archive.namelist())
                self.assertNotIn("site/server.js", names)
                self.assertNotIn("site/local_accounts.json", names)
                self.assertFalse(any("/node_modules/" in name for name in names))
                self.assertFalse(any(name.startswith("site/tools/") for name in names))
                self.assertFalse(any(name.startswith("site/backup/") for name in names))
                self.assertFalse(any("tests" in name for name in names))

    def test_release_manifest_hashes_every_published_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_fixture(root)
            archive_path = root / "dist" / "original-game.zip"

            result = run_builder(root, archive_path)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with zipfile.ZipFile(archive_path) as archive:
                manifest = json.loads(archive.read("site/ORIGINAL-RELEASE-MANIFEST.json"))
                files = manifest["files"]
                self.assertIn("site/index.html", files)
                for name, expected_hash in files.items():
                    self.assertEqual(
                        hashlib.sha256(archive.read(name)).hexdigest(),
                        expected_hash,
                        name,
                    )

    def test_release_refuses_a_missing_cocos_bootstrap_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_fixture(root)
            (root / "client/src/system.bundle.543e6.js").unlink()

            result = run_builder(root, root / "dist" / "original-game.zip")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("system.bundle.543e6.js", result.stdout + result.stderr)

    def test_release_refuses_a_missing_asset_pack_referenced_by_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_fixture(root)
            (root / "client/assets-packs/tiles.pack").unlink()

            result = run_builder(root, root / "dist" / "original-game.zip")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("tiles.pack", result.stdout + result.stderr)

    def test_release_refuses_symlinks_inside_the_original_client_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_fixture(root)
            outside = root / "outside.js"
            outside.write_text("outside", encoding="utf-8")
            link = root / "client/assets/main/linked.js"
            link.symlink_to(outside)

            result = run_builder(root, root / "dist" / "original-game.zip")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("symlink", (result.stdout + result.stderr).lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
