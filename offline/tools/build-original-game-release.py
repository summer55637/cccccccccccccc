#!/usr/bin/env python3
"""Build a deterministic, allowlisted release of the original Cocos browser client."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

DEFAULT_PACK_ORIGIN = "https://test.xiaoshu.gg"
LOCAL_PACK_TOKEN = "xiaoshu-offline-singleplayer-v1"
PACK_HOST_ALLOWLIST = {"test.xiaoshu.gg"}
REQUIRED_CLIENT_FILES = {
    "index.html",
    "index.1d55c.js",
    "application.23610.js",
    "src/polyfills.bundle.5adbf.js",
    "src/system.bundle.543e6.js",
    "src/import-map.4e643.json",
    "src/settings.57846.json",
    "src/effect.bin",
    "cocos-js/cc.03aac.js",
    "assets/internal/config.9e58a.json",
    "assets/internal/index.9e58a.js",
    "assets/main/config.3e757.json",
    "assets/main/index.3e757.js",
    "assets/resources/config.caeb6.json",
    "assets/resources/index.caeb6.js",
    "assets/scripts/net/goline-adapter.8231b.js",
    "assets-packs/packs-manifest.json",
    "pwa/manifest.json",
    "pwa/icon-180.png",
}
REQUIRED_DATA_FILES = {
    "gamedata.json",
    "npcs.json",
    "npchtml.json",
    "castles.json",
}
OPTIONAL_DATA_FILES = {
    "rank3.json",
    "ranking.json",
    "server_time.json",
}
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_SITE_BYTES = 900 * 1024 * 1024
FIXED_ZIP_TIME = (2020, 1, 1, 0, 0, 0)
ALREADY_COMPRESSED = {
    ".pack", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".wasm",
    ".bin", ".mp3", ".ogg", ".m4a", ".woff", ".woff2", ".ttf",
}
TEXT_TYPES = {".html", ".css", ".js", ".json", ".webmanifest", ".txt"}


class ReleaseBuildError(RuntimeError):
    """A release is incomplete or violates the original-game package boundary."""


def safe_relative(value: str) -> str:
    pure = PurePosixPath(value)
    if (
        not value
        or pure.is_absolute()
        or not pure.parts
        or any(part in ("", ".", "..") for part in pure.parts)
        or "\\" in value
    ):
        raise ReleaseBuildError(f"Unsafe release path: {value}")
    return pure.as_posix()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_source_tree(root: Path, client_root: Path) -> None:
    for base in (client_root, root / "extracted_data", root / "offline" / "original"):
        if not base.exists():
            continue
        if base.is_symlink():
            raise ReleaseBuildError(f"symlink source directory is forbidden: {base}")
        for candidate in base.rglob("*"):
            if candidate.is_symlink():
                raise ReleaseBuildError(
                    f"symlink is forbidden in release sources: "
                    f"{candidate.relative_to(root).as_posix()}"
                )
            if candidate.is_file():
                try:
                    candidate.resolve(strict=True).relative_to(root)
                except (ValueError, OSError) as error:
                    raise ReleaseBuildError(
                        f"source file escapes repository root: {candidate}"
                    ) from error


def validate_pack_name(file_name: str) -> str:
    relative = safe_relative(file_name)
    if "/" in relative or relative in ("", ".", "..") or not relative.endswith(".pack"):
        raise ReleaseBuildError(f"Invalid asset pack filename: {file_name}")
    return relative


def download_pack(
    file_name: str,
    expected_size: int,
    pack_origin: str,
    destination: Path,
) -> int:
    parsed_origin = urllib.parse.urlparse(pack_origin)
    if parsed_origin.scheme != "https" or parsed_origin.hostname not in PACK_HOST_ALLOWLIST:
        raise ReleaseBuildError(
            f"Asset pack download host is not allowlisted: {pack_origin}"
        )
    safe_name = validate_pack_name(file_name)
    url = f"{pack_origin.rstrip('/')}/assets-packs/{urllib.parse.quote(safe_name)}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    actual = 0
    range_bytes = 256 * 1024
    with destination.open("wb") as output:
        while actual < expected_size:
            start = actual
            end = min(expected_size - 1, start + range_bytes - 1)
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Original-Cocos-Offline-Release/1.0",
                    "Accept-Encoding": "identity",
                    "Range": f"bytes={start}-{end}",
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    final = urllib.parse.urlparse(response.geturl())
                    if final.scheme != "https" or final.hostname not in PACK_HOST_ALLOWLIST:
                        raise ReleaseBuildError(
                            f"Asset pack request redirected outside allowlist: {file_name}"
                        )
                    status = getattr(response, "status", 200)
                    content_range = response.headers.get("Content-Range", "")
                    content_encoding = response.headers.get("Content-Encoding", "identity")
                    content_length = response.headers.get("Content-Length", "")
                    if status == 206:
                        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", content_range.strip())
                        if not match:
                            raise ReleaseBuildError(
                                f"Asset pack returned an invalid Content-Range for {file_name}: "
                                f"{content_range or '<missing>'}"
                            )
                        range_start, range_end, total = map(int, match.groups())
                        expected_chunk = end - start + 1
                        if (
                            range_start != start
                            or range_end != end
                            or total != expected_size
                        ):
                            raise ReleaseBuildError(
                                f"Asset pack range mismatch for {file_name}: "
                                f"requested {start}-{end}/{expected_size}, "
                                f"received {content_range or '<missing>'}"
                            )
                        if content_length and int(content_length) > expected_chunk:
                            raise ReleaseBuildError(
                                f"Asset pack Content-Length exceeds requested range for {file_name}: "
                                f"requested {expected_chunk}, got {content_length}"
                            )
                        received = 0
                        while received < expected_chunk:
                            block = response.read(min(64 * 1024, expected_chunk - received))
                            if not block:
                                break
                            output.write(block)
                            received += len(block)
                        if received <= 0:
                            raise ReleaseBuildError(
                                f"Asset pack range made no progress for {file_name}: "
                                f"requested {start}-{end}, read {received}"
                            )
                        if received == expected_chunk and response.read(1):
                            raise ReleaseBuildError(
                                f"Asset pack body exceeded its Content-Range for {file_name}"
                            )
                        # Some CDN edges terminate a valid 206 response early.
                        # Advance by the bytes actually received and request the
                        # remaining range instead of publishing a partial pack.
                        actual += received
                    elif status == 200 and start == 0:
                        received = 0
                        while True:
                            block = response.read(64 * 1024)
                            if not block:
                                break
                            received += len(block)
                            if received > expected_size:
                                raise ReleaseBuildError(
                                    f"Asset pack response is larger than manifest size: {file_name}"
                                )
                            output.write(block)
                        if received != expected_size:
                            raise ReleaseBuildError(
                                f"Asset pack full response was truncated for {file_name}: "
                                f"expected {expected_size}, read {received}; "
                                f"Content-Length={content_length or '<missing>'}"
                            )
                        actual = received
                    else:
                        raise ReleaseBuildError(
                            f"Asset pack download did not return a complete range for {file_name}: "
                            f"HTTP {status}, Content-Length={content_length or '<missing>'}, "
                            f"Content-Encoding={content_encoding}, "
                            f"Content-Range={content_range or '<missing>'} at offset {start}"
                        )
            except urllib.error.HTTPError as error:
                raise ReleaseBuildError(
                    f"Asset pack download failed with HTTP {error.code} at byte {start}: {file_name}"
                ) from error
            except urllib.error.URLError as error:
                raise ReleaseBuildError(
                    f"Asset pack download failed at byte {start}: {file_name}: {error.reason}"
                ) from error
    if actual != expected_size:
        raise ReleaseBuildError(
            f"Asset pack size mismatch for {file_name}: expected {expected_size}, got {actual}"
        )
    if actual <= 0:
        raise ReleaseBuildError(f"Asset pack download was empty: {file_name}")
    return actual


def collect_release_files(
    repository_root: Path,
    *,
    fetch_missing_packs: bool = False,
    pack_origin: str = DEFAULT_PACK_ORIGIN,
    temporary_root: Path | None = None,
) -> tuple[dict[str, Path], dict[str, int]]:
    root = repository_root.resolve()
    client_root = root / "client"
    if not client_root.is_dir():
        raise ReleaseBuildError("Missing original Cocos client directory: client/")
    validate_source_tree(root, client_root)

    missing_required = [
        relative for relative in sorted(REQUIRED_CLIENT_FILES)
        if not (client_root / relative).is_file()
    ]
    if missing_required:
        raise ReleaseBuildError(
            "Missing original Cocos bootstrap files: " + ", ".join(missing_required)
        )

    selected: dict[str, Path] = {}
    for candidate in sorted(client_root.rglob("*")):
        if not candidate.is_file():
            continue
        relative = safe_relative(candidate.relative_to(client_root).as_posix())
        destination = safe_relative(f"site/{relative}")
        selected[destination] = candidate

    data_root = root / "extracted_data"
    if not data_root.is_dir():
        raise ReleaseBuildError("Missing extracted_data/ game data directory")
    for name in sorted(REQUIRED_DATA_FILES):
        source = data_root / name
        if not source.is_file():
            raise ReleaseBuildError(f"Missing required game data file: extracted_data/{name}")
        try:
            json.loads(source.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ReleaseBuildError(f"Game data is not valid UTF-8 JSON: {name}") from error
        selected[safe_relative(f"site/{name}")] = source

    for name in sorted(OPTIONAL_DATA_FILES):
        source = data_root / name
        if source.is_file():
            try:
                json.loads(source.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ReleaseBuildError(f"Optional game data is not valid JSON: {name}") from error
            selected[safe_relative(f"site/{name}")] = source

    original_root = root / "offline" / "original"
    if original_root.is_dir():
        for candidate in sorted(original_root.rglob("*")):
            if not candidate.is_file():
                continue
            relative = safe_relative(candidate.relative_to(root).as_posix())
            selected[safe_relative(f"site/{relative}")] = candidate

    # Wrap the original AES-GCM asset key for the accountless local token.
    # The raw key is read from server.js only during packaging and is never
    # copied into the public site.
    server_key_source = root / "server.js"
    key_wrapper_tool = root / "offline" / "tools" / "create-local-packkey.mjs"
    if not server_key_source.is_file() or not key_wrapper_tool.is_file():
        raise ReleaseBuildError("Missing build-time source for original Cocos pack-key wrapping")
    pack_key_path = download_root / "local-packkey.json"
    try:
        wrapped = subprocess.run(
            [
                "node",
                str(key_wrapper_tool),
                "--server",
                str(server_key_source),
                "--output",
                str(pack_key_path),
                "--token",
                LOCAL_PACK_TOKEN,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ReleaseBuildError("Could not run the local pack-key wrapper tool") from error
    if wrapped.returncode != 0 or not pack_key_path.is_file():
        raise ReleaseBuildError(
            "Could not generate the local pack-key wrapper: "
            + (wrapped.stderr.strip() or "wrapper tool failed")
        )
    try:
        wrapper_data = json.loads(pack_key_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseBuildError("Generated local pack-key wrapper is invalid JSON") from error
    if (
        wrapper_data.get("ok") is not True
        or wrapper_data.get("v") != 2
        or wrapper_data.get("token") != LOCAL_PACK_TOKEN
        or not isinstance(wrapper_data.get("wrap"), str)
    ):
        raise ReleaseBuildError("Generated local pack-key wrapper failed validation")
    selected["site/offline/original/local-packkey.json"] = pack_key_path

    # Cocos loads this file before its first scene. Keep every original relative
    # path intact and verify every PWA icon resolves within the published site.
    try:
        pwa = json.loads((client_root / "pwa/manifest.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseBuildError("Original Cocos PWA manifest is invalid JSON") from error
    for icon in pwa.get("icons", []):
        src = str(icon.get("src", ""))
        if not src or src.startswith(("http:", "https:", "//")):
            raise ReleaseBuildError(f"Original PWA icon must be local: {src}")
        relative = safe_relative(src.removeprefix("./"))
        if f"site/pwa/{relative}" not in selected:
            raise ReleaseBuildError(f"Original PWA icon is missing from client/: {src}")

    packs_manifest_path = client_root / "assets-packs/packs-manifest.json"
    try:
        packs_manifest = json.loads(packs_manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseBuildError("Original asset pack manifest is invalid JSON") from error
    groups = packs_manifest.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ReleaseBuildError("Original asset pack manifest has no groups")

    pack_count = 0
    pack_bytes = 0
    downloaded_count = 0
    downloaded_bytes = 0
    download_root = temporary_root or Path(tempfile.mkdtemp(prefix="original-cocos-packs-"))
    seen_files: set[str] = set()
    for group in groups:
        if not isinstance(group, dict):
            raise ReleaseBuildError("Original asset pack manifest contains an invalid group")
        raw_name = group.get("file")
        if not isinstance(raw_name, str):
            raise ReleaseBuildError("Original asset pack group is missing its file name")
        file_name = validate_pack_name(raw_name)
        if file_name in seen_files:
            continue
        seen_files.add(file_name)
        expected_size = int(group.get("size") or 0)
        if expected_size <= 0 or expected_size > MAX_FILE_BYTES:
            raise ReleaseBuildError(
                f"Invalid or oversized asset pack manifest entry: {file_name}"
            )
        relative = safe_relative(f"site/assets-packs/{file_name}")
        local = client_root / "assets-packs" / file_name
        if local.is_file():
            actual_size = local.stat().st_size
            if actual_size != expected_size:
                raise ReleaseBuildError(
                    f"Local asset pack size mismatch for {file_name}: "
                    f"expected {expected_size}, got {actual_size}"
                )
        elif fetch_missing_packs:
            local = download_root / file_name
            downloaded_bytes += download_pack(
                file_name, expected_size, pack_origin, local
            )
            downloaded_count += 1
        else:
            raise ReleaseBuildError(
                f"Missing asset pack {file_name}; rerun with --fetch-missing-packs"
            )
        selected[relative] = local
        pack_count += 1
        pack_bytes += expected_size

    # Keep the complete source list, but report coverage explicitly in the
    # archive so a missing pack can never be mistaken for a complete release.
    coverage_path = download_root / "ASSET-COVERAGE.json"
    coverage_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "sourceGroupCount": len(groups),
                "includedPackCount": pack_count,
                "includedPackBytes": pack_bytes,
                "downloadedPackCount": downloaded_count,
                "downloadedPackBytes": downloaded_bytes,
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    selected["site/ASSET-COVERAGE.json"] = coverage_path
    nojekyll_path = download_root / ".nojekyll"
    nojekyll_path.write_text("", encoding="utf-8")
    selected["site/.nojekyll"] = nojekyll_path

    total_bytes = sum(path.stat().st_size for path in selected.values())
    for relative, path in selected.items():
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise ReleaseBuildError(
                f"File exceeds GitHub Pages' 100 MB per-file limit: {relative} ({size} bytes)"
            )
    if total_bytes > MAX_SITE_BYTES:
        raise ReleaseBuildError(
            f"Published site exceeds the 900 MiB safety limit: {total_bytes} bytes"
        )
    return selected, {
        "files": len(selected),
        "siteBytes": total_bytes,
        "packGroups": len(groups),
        "packFiles": pack_count,
        "packBytes": pack_bytes,
        "downloadedPacks": downloaded_count,
        "downloadedBytes": downloaded_bytes,
    }


def build_release(
    repository_root: Path,
    output_path: Path,
    *,
    fetch_missing_packs: bool = False,
    pack_origin: str = DEFAULT_PACK_ORIGIN,
) -> dict[str, int | str]:
    root = repository_root.resolve()
    output = output_path if output_path.is_absolute() else root / output_path
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="original-cocos-build-", dir=output.parent) as temporary:
        temporary_root = Path(temporary)
        selected, stats = collect_release_files(
            root,
            fetch_missing_packs=fetch_missing_packs,
            pack_origin=pack_origin,
            temporary_root=temporary_root,
        )
        hashes = {
            name: sha256_file(path)
            for name, path in sorted(selected.items())
        }
        manifest = {
            "schemaVersion": 1,
            "sourceCommit": os.environ.get("GITHUB_SHA") or None,
            "files": hashes,
            "assetCoverage": {
                "packGroups": stats["packGroups"],
                "packFiles": stats["packFiles"],
                "packBytes": stats["packBytes"],
                "downloadedPacks": stats["downloadedPacks"],
            },
        }
        manifest_path = temporary_root / "ORIGINAL-RELEASE-MANIFEST.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        selected["site/ORIGINAL-RELEASE-MANIFEST.json"] = manifest_path

        temporary_output = output.with_suffix(output.suffix + ".part")
        try:
            with zipfile.ZipFile(
                temporary_output,
                "w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=1,
                allowZip64=True,
            ) as archive:
                for relative, source in sorted(selected.items()):
                    info = zipfile.ZipInfo(relative, FIXED_ZIP_TIME)
                    info.create_system = 3
                    info.external_attr = 0o100644 << 16
                    extension = source.suffix.lower()
                    if extension in ALREADY_COMPRESSED:
                        info.compress_type = zipfile.ZIP_STORED
                    else:
                        info.compress_type = zipfile.ZIP_DEFLATED
                    with source.open("rb") as stream:
                        archive.writestr(
                            info,
                            stream.read(),
                            compress_type=info.compress_type,
                            compresslevel=1 if info.compress_type == zipfile.ZIP_DEFLATED else None,
                        )
            temporary_output.replace(output)
        except Exception:
            temporary_output.unlink(missing_ok=True)
            raise

    return {
        **stats,
        "archiveBytes": output.stat().st_size,
        "output": str(output),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a safe, complete static release of the original Cocos client."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Repository root (defaults to the Git repository root)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("dist/original-cocos-offline.zip"),
        help="Release ZIP output path",
    )
    parser.add_argument(
        "--fetch-missing-packs",
        action="store_true",
        help="Download missing manifest-listed asset packs from the allowlisted original asset host",
    )
    parser.add_argument(
        "--pack-origin",
        default=DEFAULT_PACK_ORIGIN,
        help="HTTPS origin used only with --fetch-missing-packs",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = build_release(
            args.root,
            args.output,
            fetch_missing_packs=args.fetch_missing_packs,
            pack_origin=args.pack_origin,
        )
    except (OSError, ValueError, ReleaseBuildError, zipfile.BadZipFile) as error:
        print(f"Original Cocos release build failed: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
