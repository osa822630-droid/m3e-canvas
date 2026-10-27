#!/usr/bin/env python3
"""Validate and create or read M3E Canvas links using the Python standard library."""

import argparse
import base64
import binascii
import copy
import json
import math
import re
import sys
import zlib
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

DEFAULT_EDITOR = "https://lnkiai.github.io/m3e-canvas/"
CONSTRAINTS_PATH = Path(__file__).resolve().parent.parent / "assets" / "project-constraints.json"
# The guide recommends ~100 KB. The larger hard limit also accommodates existing
# projects while preventing a tiny compressed link from expanding indefinitely.
MAX_PROJECT_BYTES = 10 * 1024 * 1024


def reject_constant(value):
    raise ValueError(f"Invalid JSON number: {value}")


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def require(condition, path, message):
    if not condition:
        raise ValueError(f"{path}: {message}")


def optional(obj, key, predicate):
    return key not in obj or predicate(obj[key])


def validate_project(project, constraints):
    """Check the fields the editor's isProject checks before it opens a project."""
    is_string = lambda value: isinstance(value, str)
    is_boolean = lambda value: isinstance(value, bool)
    positive = lambda value: finite(value) and value > 0
    choice = lambda key: lambda value: is_string(value) and value in constraints[key]

    require(isinstance(project, dict), "project", "expected an object")
    require(isinstance(project.get("frames"), list), "frames", "expected an array")
    require(isinstance(project.get("groups"), list), "groups", "expected an array")
    require(optional(project, "platform", lambda value: value in ("android", "web")), "platform", "expected android or web")
    require(optional(project, "promptOptions", lambda value: isinstance(value, list) and all(is_string(option) for option in value)), "promptOptions", "expected an array of strings")

    for index, frame in enumerate(project["frames"]):
        path = f"frames[{index}]"
        require(isinstance(frame, dict), path, "expected an object")
        for key in ("id", "name"):
            require(is_string(frame.get(key)), f"{path}.{key}", "expected a string")
        for key in ("x", "y"):
            require(finite(frame.get(key)), f"{path}.{key}", "expected a finite number")
        for key in ("w", "h", "length"):
            require(optional(frame, key, positive), f"{path}.{key}", "expected a positive number")
        require(optional(frame, "note", is_string), f"{path}.note", "expected a string")
        require(optional(frame, "place", choice("places")), f"{path}.place", "unknown placement")

    for group_index, group in enumerate(project["groups"]):
        path = f"groups[{group_index}]"
        require(isinstance(group, dict), path, "expected an object")
        require(is_string(group.get("id")), f"{path}.id", "expected a string")
        for key in ("x", "y"):
            require(finite(group.get(key)), f"{path}.{key}", "expected a finite number")
        require(group.get("axis") in ("x", "y"), f"{path}.axis", "expected x or y")
        require(optional(group, "locked", is_boolean), f"{path}.locked", "expected a boolean")
        require(isinstance(group.get("items"), list) and bool(group["items"]), f"{path}.items", "expected a nonempty array")

        for item_index, item in enumerate(group["items"]):
            item_path = f"{path}.items[{item_index}]"
            require(isinstance(item, dict), item_path, "expected an object")
            for key in ("id", "label"):
                require(is_string(item.get(key)), f"{item_path}.{key}", "expected a string")
            require(choice("kinds")(item.get("kind")), f"{item_path}.kind", "unknown part kind")
            require(choice("variants")(item.get("variant")), f"{item_path}.variant", "unknown variant")
            require("icon" in item and (item["icon"] is None or is_string(item["icon"])), f"{item_path}.icon", "expected a string or null")
            for key in ("supporting", "note"):
                require(optional(item, key, is_string), f"{item_path}.{key}", "expected a string")
            for key in ("railExpanded", "railModal", "collapseOnScroll"):
                require(optional(item, key, is_boolean), f"{item_path}.{key}", "expected a boolean")
            for key in ("selected", "count", "size", "size2", "radiusTop", "radiusBottom", "value"):
                require(optional(item, key, finite), f"{item_path}.{key}", "expected a finite number")
            for key, choices in (("layout", "layouts"), ("imagePos", "cardImagePositions"), ("contentAlign", "cardAlignments"), ("textAlign", "cardAlignments"), ("textColor", "textColors")):
                require(optional(item, key, choice(choices)), f"{item_path}.{key}", "unknown value")
            require(optional(item, "imageSize", positive), f"{item_path}.imageSize", "expected a positive number")

            limits = constraints["trackThickness"]
            thickness = lambda value: finite(value) and value == int(value) and limits["min"] <= value <= limits["max"]
            require(optional(item, "trackThickness", thickness), f"{item_path}.trackThickness", "expected a supported integer")
            corners = item.get("corners")
            require("corners" not in item or (isinstance(corners, dict) and all(finite(corners.get(key)) for key in ("tl", "tr", "bl", "br"))), f"{item_path}.corners", "expected four finite corner values")
            if "tabs" in item:
                tabs = item["tabs"]
                require(isinstance(tabs, list), f"{item_path}.tabs", "expected an array")
                for tab_index, tab in enumerate(tabs):
                    tab_path = f"{item_path}.tabs[{tab_index}]"
                    require(isinstance(tab, dict), tab_path, "expected an object")
                    require(is_string(tab.get("label")), f"{tab_path}.label", "expected a string")
                    require(optional(tab, "icon", lambda value: value is None or is_string(value)), f"{tab_path}.icon", "expected a string or null")
                    require(optional(tab, "src", is_string), f"{tab_path}.src", "expected a string")


def parse_project(text):
    if len(text.encode("utf-8")) > MAX_PROJECT_BYTES:
        raise ValueError("Project JSON is too large (maximum 10 MB).")
    project = json.loads(text, parse_constant=reject_constant)
    constraints = json.loads(CONSTRAINTS_PATH.read_text(encoding="utf-8"))
    validate_project(project, constraints)
    return project


def shareable(project):
    """Match the editor's share filter without changing the original project."""
    result = copy.deepcopy(project)
    for frame in result["frames"]:
        frame.pop("noteHistory", None)
    for group in result["groups"]:
        for item in group["items"]:
            item.pop("noteHistory", None)
            src = item.get("src")
            if not isinstance(src, str) or not re.match(r"^https?://", src):
                item.pop("src", None)
    return result


def encode(project, base_url=DEFAULT_EDITOR):
    base = urlsplit(base_url)
    if base.scheme not in ("http", "https") or not base.netloc or "#" in base_url:
        raise ValueError("The editor URL must be an HTTP(S) URL without a fragment.")
    text = json.dumps(shareable(project), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    data = text.encode("utf-8")
    if len(data) > MAX_PROJECT_BYTES:
        raise ValueError("Project JSON is too large (maximum 10 MB).")
    compressor = zlib.compressobj(level=9, wbits=-zlib.MAX_WBITS)
    packed = compressor.compress(data) + compressor.flush()
    payload = base64.urlsafe_b64encode(packed).decode("ascii").rstrip("=")
    return f"{base_url}#docz={payload}"


def inflate(payload):
    if not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", payload):
        raise ValueError("The compressed link has invalid base64url data.")
    padded = payload + "=" * ((-len(payload)) % 4)
    packed = base64.b64decode(padded, altchars=b"-_", validate=True)
    decompressor = zlib.decompressobj(wbits=-zlib.MAX_WBITS)
    data = decompressor.decompress(packed, MAX_PROJECT_BYTES + 1)
    if len(data) > MAX_PROJECT_BYTES or decompressor.unconsumed_tail:
        raise ValueError("The project in this link is too large (maximum 10 MB).")
    if not decompressor.eof or decompressor.unused_data:
        raise ValueError("The compressed link is incomplete or invalid.")
    return data.decode("utf-8")


def decode(link):
    link = link.strip()
    if "#" in link:
        fragment = link.split("#", 1)[1]
    elif link.startswith(("doc=", "docz=")):
        fragment = link
    else:
        raise ValueError("The link has no M3E Canvas project fragment.")
    params = parse_qs(fragment, keep_blank_values=True)
    packed = params.get("docz", [""])[0]
    plain = params.get("doc", [""])[0]
    if packed:
        text = inflate(packed)
    elif plain:
        text = plain
    else:
        raise ValueError("The link has no M3E Canvas project fragment.")
    return parse_project(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("encode", help="encode a project JSON file as a share link")
    make.add_argument("project", type=Path, help="path to a UTF-8 project JSON file")
    make.add_argument("--base-url", default=DEFAULT_EDITOR, help="editor URL without a fragment")
    read = commands.add_parser("decode", help="decode a link from a text file as project JSON")
    read.add_argument("link", type=Path, help="path to a UTF-8 file containing the complete link")
    args = parser.parse_args()

    try:
        if args.command == "encode":
            if args.project.stat().st_size > MAX_PROJECT_BYTES:
                raise ValueError("Project JSON is too large (maximum 10 MB).")
            print(encode(parse_project(args.project.read_text(encoding="utf-8")), args.base_url))
        else:
            if args.link.stat().st_size > MAX_PROJECT_BYTES * 4:
                raise ValueError("Link file is too large.")
            project = decode(args.link.read_text(encoding="utf-8"))
            print(json.dumps(project, ensure_ascii=False, indent=2, allow_nan=False))
    except (OSError, UnicodeError, ValueError, binascii.Error, zlib.error) as error:
        parser.exit(2, f"canvas_link: {error}\n")


if __name__ == "__main__":
    main()
