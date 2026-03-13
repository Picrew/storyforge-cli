#!/usr/bin/env python3
from __future__ import annotations

import copy
import datetime as dt
import json
import re
import sys
import uuid
from typing import Any, Dict, Iterable, List, Tuple


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def chapter_number(chapter_id: str | None) -> int | None:
    if not chapter_id:
        return None
    match = re.match(r"^ch(\d+)$", chapter_id.strip().lower())
    if not match:
        return None
    value = int(match.group(1))
    return value if value > 0 else None


def normalize_chapter_id(chapter_id: str | None) -> str:
    parsed = chapter_number(chapter_id)
    if parsed is None:
        return "ch01"
    return f"ch{parsed:02d}"


def ensure_project_v2(project: Dict[str, Any]) -> Dict[str, Any]:
    project.setdefault("version", 2)
    project.setdefault("eventCommits", [])
    project.setdefault("inventory", [])
    project.setdefault("foreshadows", [])
    project.setdefault("dependencyGraph", {"edges": [], "updatedAt": now_iso()})
    project.setdefault("chapterRenders", [])
    project.setdefault("ciHistory", [])
    project.setdefault("dirtyChapters", [])
    project.setdefault("world", {})
    project.setdefault("characters", [])
    project.setdefault("timeline", [])
    project.setdefault("outline", [])
    project.setdefault("meta", {})
    project["version"] = 2
    return project


def issue(rule: str, severity: str, message: str, chapter_id: str | None = None, commit_id: str | None = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "rule": rule,
        "severity": severity,
        "message": message,
    }
    if chapter_id:
        payload["chapterId"] = chapter_id
    if commit_id:
        payload["commitId"] = commit_id
    return payload


def normalize_optional_string(value: Any) -> str | None:
    if value is None:
        return None

    normalized = value.strip() if isinstance(value, str) else str(value).strip()
    if not normalized:
        return None

    if normalized.lower() in {"none", "null", "undefined"}:
        return None

    return normalized


def parse_quantity(value: Any, default: int = 1) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        parsed = int(round(value))
        return parsed if parsed > 0 else default
    return default


def find_character(project: Dict[str, Any], token: Any) -> Dict[str, Any] | None:
    if not isinstance(token, str):
        return None
    normalized = token.strip().lower()
    for character in project.get("characters", []):
        if str(character.get("id", "")).lower() == normalized:
            return character
        if str(character.get("name", "")).lower() == normalized:
            return character
    return None


def find_timeline_beat(project: Dict[str, Any], token: Any) -> Dict[str, Any] | None:
    if isinstance(token, (int, float)):
        index = int(token) - 1
        timeline = project.get("timeline", [])
        if 0 <= index < len(timeline):
            return timeline[index]
        return None

    if not isinstance(token, str):
        return None
    normalized = token.strip().lower()
    for beat in project.get("timeline", []):
        if str(beat.get("id", "")).lower() == normalized:
            return beat
        if str(beat.get("label", "")).lower() == normalized:
            return beat
    return None


def insert_timeline_beat(project: Dict[str, Any], beat: Dict[str, Any]) -> None:
    timeline = project.get("timeline")
    if not isinstance(timeline, list):
        timeline = []
        project["timeline"] = timeline

    target_chapter = extract_chapter_number_from_ref(beat.get("chapterRef"))
    if target_chapter is None or len(timeline) == 0:
        timeline.append(beat)
        return

    insert_index = len(timeline)
    for index, existing in enumerate(timeline):
        existing_chapter = extract_chapter_number_from_ref(existing.get("chapterRef"))
        if existing_chapter is None:
            continue
        if existing_chapter > target_chapter:
            insert_index = index
            break

    timeline.insert(insert_index, beat)


def find_item(project: Dict[str, Any], token: Any) -> Dict[str, Any] | None:
    if not isinstance(token, str):
        return None
    normalized = token.strip().lower()
    for item in project.get("inventory", []):
        if str(item.get("id", "")).lower() == normalized:
            return item
        if str(item.get("name", "")).lower() == normalized:
            return item
    return None


def find_foreshadow(project: Dict[str, Any], token: Any) -> Dict[str, Any] | None:
    if not isinstance(token, str):
        return None
    normalized = token.strip().lower()
    for entry in project.get("foreshadows", []):
        if str(entry.get("id", "")).lower() == normalized:
            return entry
        if str(entry.get("label", "")).lower() == normalized:
            return entry
    return None


def infer_accesses(patch_ops: Iterable[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    reads: set[str] = set()
    writes: set[str] = set()

    for raw_op in patch_ops:
        op = str(raw_op.get("op", "")).strip().lower()
        payload = raw_op.get("payload", {})
        payload = payload if isinstance(payload, dict) else {}

        if op == "world.set":
            field = str(payload.get("field", "")).strip()
            if field:
                writes.add(f"world:{field}")
            continue

        if op == "character.set":
            character_token = str(payload.get("character", payload.get("characterId", ""))).strip()
            if character_token:
                reads.add(f"character:{character_token}")
                writes.add(f"character:{character_token}")
            continue

        if op in {"timeline.add", "timeline.set"}:
            writes.add("timeline")
            continue

        if op.startswith("item."):
            item_token = str(payload.get("item", payload.get("itemId", payload.get("id", "")))).strip()
            if item_token:
                reads.add(f"item:{item_token}")
                writes.add(f"item:{item_token}")
            from_holder = str(payload.get("from", "")).strip()
            to_holder = str(payload.get("to", "")).strip()
            if from_holder:
                reads.add(f"character:{from_holder}")
            if to_holder and to_holder.lower() != "world":
                reads.add(f"character:{to_holder}")
            continue

        if op.startswith("foreshadow."):
            token = str(payload.get("id", payload.get("label", ""))).strip()
            if token:
                reads.add(f"foreshadow:{token}")
                writes.add(f"foreshadow:{token}")
            continue

    return sorted(reads), sorted(writes)


def action_plan_patch(request: Dict[str, Any]) -> Dict[str, Any]:
    chapter_id = normalize_chapter_id(request.get("chapter_id"))
    event_text = str(request.get("event_text", "")).strip()
    if not event_text:
        raise ValueError("event_text is required for plan_patch.")

    patch_ops: List[Dict[str, Any]] = [
        {
            "op": "timeline.add",
            "target": "timeline",
            "payload": {
                "label": event_text[:48],
                "summary": event_text,
                "chapterRef": chapter_id,
                "stakes": "",
                "notes": "auto-planned by python fallback",
            },
        }
    ]
    reads, writes = infer_accesses(patch_ops)
    return {
        "ok": True,
        "patch_ops": patch_ops,
        "reads": reads,
        "writes": writes,
    }


def apply_patch_op(project: Dict[str, Any], chapter_id: str, patch_op: Dict[str, Any]) -> None:
    op = str(patch_op.get("op", "")).strip().lower()
    payload = patch_op.get("payload", {})
    payload = payload if isinstance(payload, dict) else {}

    if op == "world.set":
        field = str(payload.get("field", "")).strip()
        if not field:
            raise ValueError("world.set requires payload.field")
        if field not in project["world"]:
            raise ValueError(f"Unknown world field: {field}")
        project["world"][field] = str(payload.get("value", ""))
        return

    if op == "character.set":
        character = find_character(project, payload.get("character", payload.get("characterId")))
        if not character:
            raise ValueError("character.set target not found")
        field = str(payload.get("field", "")).strip()
        if field not in {
            "name",
            "role",
            "age",
            "description",
            "motivation",
            "conflict",
            "arc",
            "relationships",
            "tags",
        }:
            raise ValueError(f"Unknown character field: {field}")
        character[field] = str(payload.get("value", ""))
        return

    if op == "timeline.add":
        label = str(payload.get("label", "")).strip() or "Untitled Beat"
        beat = {
            "id": str(payload.get("id", uuid.uuid4())),
            "label": label,
            "summary": str(payload.get("summary", "")),
            "chapterRef": str(payload.get("chapterRef", chapter_id)),
            "stakes": str(payload.get("stakes", "")),
            "notes": str(payload.get("notes", "")),
        }
        insert_timeline_beat(project, beat)
        return

    if op == "timeline.set":
        beat = find_timeline_beat(project, payload.get("beat", payload.get("beatId")))
        if not beat:
            raise ValueError("timeline.set target beat not found")
        field = str(payload.get("field", "")).strip()
        if field not in {"label", "summary", "chapterRef", "stakes", "notes"}:
            raise ValueError(f"Unknown timeline field: {field}")
        beat[field] = str(payload.get("value", ""))
        return

    if op == "item.create":
        item_id = str(payload.get("id", uuid.uuid4()))
        name = str(payload.get("name", item_id))
        existing = find_item(project, item_id)
        if existing:
            raise ValueError(f"item.create item already exists: {item_id}")
        holder = str(payload.get("holder", "world")).strip() or "world"
        quantity = parse_quantity(payload.get("quantity"), 1)
        holders = {holder: quantity}
        project["inventory"].append(
            {
                "id": item_id,
                "name": name,
                "holders": holders,
                "total": quantity,
                "status": "active",
                "notes": str(payload.get("notes", "")),
            }
        )
        return

    if op == "item.transfer":
        item = find_item(project, payload.get("item", payload.get("itemId")))
        if not item:
            raise ValueError("item.transfer target not found")
        from_holder = str(payload.get("from", "")).strip()
        to_holder = str(payload.get("to", "")).strip()
        if not from_holder or not to_holder:
            raise ValueError("item.transfer requires from and to")
        quantity = parse_quantity(payload.get("quantity"), 1)
        holders = item.setdefault("holders", {})
        current_from = int(holders.get(from_holder, 0))
        if current_from < quantity:
            raise ValueError("item.transfer quantity exceeds source holder inventory")
        holders[from_holder] = current_from - quantity
        holders[to_holder] = int(holders.get(to_holder, 0)) + quantity
        return

    if op == "item.consume":
        item = find_item(project, payload.get("item", payload.get("itemId")))
        if not item:
            raise ValueError("item.consume target not found")
        quantity = parse_quantity(payload.get("quantity"), 1)
        holder = str(payload.get("holder", "")).strip()
        holders = item.setdefault("holders", {})
        if holder:
            available = int(holders.get(holder, 0))
            if available < quantity:
                raise ValueError("item.consume quantity exceeds holder inventory")
            holders[holder] = available - quantity
        else:
            remaining = quantity
            for holder_key in sorted(holders.keys()):
                if remaining <= 0:
                    break
                available = int(holders.get(holder_key, 0))
                if available <= 0:
                    continue
                used = min(available, remaining)
                holders[holder_key] = available - used
                remaining -= used
            if remaining > 0:
                raise ValueError("item.consume quantity exceeds total inventory")
        item["total"] = max(0, int(item.get("total", 0)) - quantity)
        if int(item["total"]) == 0:
            item["status"] = "consumed"
        return

    if op == "foreshadow.add":
        entry_id = str(payload.get("id", uuid.uuid4()))
        label = str(payload.get("label", "")).strip() or f"Foreshadow {entry_id[:8]}"
        raw_due = payload.get("dueChapter")
        due_chapter_str = str(raw_due).strip() if raw_due is not None and str(raw_due).strip() else ""
        due_chapter = normalize_chapter_id(due_chapter_str) if due_chapter_str else chapter_id
        if find_foreshadow(project, entry_id):
            raise ValueError(f"foreshadow.add entry already exists: {entry_id}")
        project["foreshadows"].append(
            {
                "id": entry_id,
                "label": label,
                "introducedChapter": chapter_id,
                "dueChapter": due_chapter,
                "resolvedChapter": None,
                "status": "open",
                "notes": str(payload.get("notes", "")),
            }
        )
        return

    if op == "foreshadow.resolve":
        entry = find_foreshadow(project, payload.get("id", payload.get("label")))
        if not entry:
            raise ValueError("foreshadow.resolve target not found")
        resolved_chapter = normalize_chapter_id(str(payload.get("resolvedChapter", chapter_id)))
        entry["resolvedChapter"] = resolved_chapter
        entry["status"] = "resolved"
        return

    raise ValueError(f"Unsupported patch operation: {op}")


def action_apply_patch(request: Dict[str, Any]) -> Dict[str, Any]:
    project = ensure_project_v2(copy.deepcopy(request.get("project_state", {})))
    raw_chapter_id = request.get("chapter_id")
    if chapter_number(raw_chapter_id) is None:
        raise ValueError(f"Invalid chapter id: {raw_chapter_id}")
    chapter_id = normalize_chapter_id(raw_chapter_id)
    patch_ops = request.get("patch_ops")
    if not isinstance(patch_ops, list) or len(patch_ops) == 0:
        raise ValueError("patch_ops must be a non-empty array.")

    sanitized_ops: List[Dict[str, Any]] = []
    for raw_op in patch_ops:
        if not isinstance(raw_op, dict):
            raise ValueError("patch_ops must contain JSON objects.")
        sanitized = {
            "op": str(raw_op.get("op", "")).strip(),
            "target": str(raw_op.get("target", "")).strip(),
            "payload": raw_op.get("payload", {}) if isinstance(raw_op.get("payload", {}), dict) else {},
        }
        if not sanitized["op"]:
            raise ValueError("Each patch op requires op.")
        sanitized_ops.append(sanitized)

    for op in sanitized_ops:
        apply_patch_op(project, chapter_id, op)

    reads, writes = infer_accesses(sanitized_ops)
    request_reads = request.get("reads")
    request_writes = request.get("writes")

    if isinstance(request_reads, list) and all(isinstance(token, str) for token in request_reads):
        reads = sorted({token.strip() for token in request_reads if token.strip()})
    if isinstance(request_writes, list) and all(isinstance(token, str) for token in request_writes):
        writes = sorted({token.strip() for token in request_writes if token.strip()})

    return {
        "ok": True,
        "next_state": project,
        "patch_ops": sanitized_ops,
        "reads": reads,
        "writes": writes,
    }


def action_build_impact(request: Dict[str, Any]) -> Dict[str, Any]:
    project = ensure_project_v2(copy.deepcopy(request.get("project_state", {})))
    commits = project.get("eventCommits", [])

    edges: set[Tuple[str, str, str]] = set()
    for source_index, source in enumerate(commits):
        source_writes = set(source.get("writes", []))
        source_chapter = normalize_chapter_id(source.get("chapterId"))
        source_chapter_number = chapter_number(source_chapter)
        if source_chapter_number is None:
            continue
        for target_index, target in enumerate(commits):
            if target_index <= source_index:
                continue
            target_chapter = normalize_chapter_id(target.get("chapterId"))
            target_chapter_number = chapter_number(target_chapter)
            if target_chapter_number is None:
                continue
            if source_chapter_number > target_chapter_number:
                continue
            target_accesses = set(target.get("reads", [])) | set(target.get("writes", []))
            for key in source_writes & target_accesses:
                edges.add((source_chapter, target_chapter, key))

    sorted_edges = sorted(edges, key=lambda entry: (chapter_number(entry[0]) or 0, chapter_number(entry[1]) or 0, entry[2]))
    project["dependencyGraph"] = {
        "edges": [{"from": edge[0], "to": edge[1], "key": edge[2]} for edge in sorted_edges],
        "updatedAt": now_iso(),
    }

    dirty_chapters: set[str] = set()
    if commits:
        latest_chapter = normalize_chapter_id(commits[-1].get("chapterId"))
        adjacency: Dict[str, set[str]] = {}
        for edge in sorted_edges:
            adjacency.setdefault(edge[0], set()).add(edge[1])
        queue = [latest_chapter]
        while queue:
            current = queue.pop(0)
            if current in dirty_chapters:
                continue
            dirty_chapters.add(current)
            for nxt in sorted(adjacency.get(current, set())):
                if nxt not in dirty_chapters:
                    queue.append(nxt)

    sorted_dirty = sorted(dirty_chapters, key=lambda chapter: chapter_number(chapter) or 0)
    project["dirtyChapters"] = sorted_dirty

    for render in project.get("chapterRenders", []):
        chapter_id = normalize_chapter_id(render.get("chapterId"))
        render["chapterId"] = chapter_id
        render["dirty"] = chapter_id in dirty_chapters

    return {
        "ok": True,
        "dependency_graph": project["dependencyGraph"],
        "dirty_chapters": sorted_dirty,
        "next_state": project,
    }


def extract_chapter_number_from_ref(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    match = re.search(r"(\d+)", value)
    if not match:
        return None
    parsed = int(match.group(1))
    return parsed if parsed > 0 else None


def max_chapter_in_project(project: Dict[str, Any]) -> int:
    numbers: List[int] = []

    for row in project.get("outline", []):
        number = row.get("number")
        if isinstance(number, (int, float)):
            numbers.append(int(round(number)))

    for beat in project.get("timeline", []):
        parsed = extract_chapter_number_from_ref(beat.get("chapterRef"))
        if parsed is not None:
            numbers.append(parsed)

    for commit in project.get("eventCommits", []):
        parsed = chapter_number(commit.get("chapterId"))
        if parsed is not None:
            numbers.append(parsed)

    return max(numbers) if numbers else 1


def action_run_ci(request: Dict[str, Any]) -> Dict[str, Any]:
    project = ensure_project_v2(copy.deepcopy(request.get("project_state", {})))
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    requested_scope = "commit" if request.get("scope") == "commit" else "all"
    requested_commit_id = normalize_optional_string(request.get("commit_id"))

    # Rule 1: timeline monotonicity.
    last_chapter_ref: int | None = None
    for beat in project.get("timeline", []):
        raw_ref = beat.get("chapterRef", "")
        beat_ref = extract_chapter_number_from_ref(raw_ref)
        if beat_ref is None:
            if isinstance(raw_ref, str) and raw_ref.strip():
                warnings.append(
                    issue(
                        "timeline_invalid_ref",
                        "warning",
                        f"Timeline beat '{beat.get('label', '')}' has an invalid chapterRef: '{raw_ref}'.",
                    )
                )
            continue
        if last_chapter_ref is not None and beat_ref < last_chapter_ref:
            errors.append(
                issue(
                    "timeline_monotonic",
                    "error",
                    f"Timeline beat '{beat.get('label', '')}' regresses chapter order ({beat_ref} < {last_chapter_ref}).",
                    normalize_chapter_id(beat.get("chapterRef")),
                )
            )
        last_chapter_ref = beat_ref

    # Rule 2: entity reference existence.
    known_character_tokens = set()
    for character in project.get("characters", []):
        known_character_tokens.add(str(character.get("id", "")).strip().lower())
        known_character_tokens.add(str(character.get("name", "")).strip().lower())
    known_item_tokens = set(str(item.get("id", "")).strip().lower() for item in project.get("inventory", []))
    known_foreshadow_tokens = set(str(entry.get("id", "")).strip().lower() for entry in project.get("foreshadows", []))
    world_fields = set(project.get("world", {}).keys())

    commits_for_entity_checks = project.get("eventCommits", [])
    if requested_scope == "commit":
        if requested_commit_id:
            commits_for_entity_checks = [
                entry for entry in commits_for_entity_checks if str(entry.get("id", "")).strip() == requested_commit_id
            ]
            if not commits_for_entity_checks:
                errors.append(issue("entity_exists", "error", f"Unknown commit id: {requested_commit_id}"))
        else:
            commits_for_entity_checks = commits_for_entity_checks[-1:] if commits_for_entity_checks else []

    for commit in commits_for_entity_checks:
        commit_id = str(commit.get("id", "")).strip() or None
        chapter_id = normalize_chapter_id(commit.get("chapterId"))
        accesses = list(commit.get("reads", [])) + list(commit.get("writes", []))
        for token in accesses:
            if not isinstance(token, str):
                continue
            if token.startswith("character:"):
                key = token.split(":", 1)[1].strip().lower()
                if key and key not in known_character_tokens and key != "world":
                    errors.append(issue("entity_exists", "error", f"Unknown character reference: {token}", chapter_id, commit_id))
            elif token.startswith("item:"):
                key = token.split(":", 1)[1].strip().lower()
                if key and key not in known_item_tokens:
                    errors.append(issue("entity_exists", "error", f"Unknown item reference: {token}", chapter_id, commit_id))
            elif token.startswith("foreshadow:"):
                key = token.split(":", 1)[1].strip().lower()
                if key and key not in known_foreshadow_tokens:
                    errors.append(issue("entity_exists", "error", f"Unknown foreshadow reference: {token}", chapter_id, commit_id))
            elif token.startswith("world:"):
                key = token.split(":", 1)[1].strip()
                if key and key not in world_fields:
                    errors.append(issue("entity_exists", "error", f"Unknown world field reference: {token}", chapter_id, commit_id))

    # Rule 3: inventory conservation.
    for item in project.get("inventory", []):
        item_id = str(item.get("id", "")).strip() or "unknown-item"
        holders = item.get("holders", {})
        if not isinstance(holders, dict):
            errors.append(issue("inventory_conservation", "error", f"Item {item_id} has invalid holders map."))
            continue
        total = int(item.get("total", 0))
        if total < 0:
            errors.append(issue("inventory_conservation", "error", f"Item {item_id} has negative total."))
            continue
        running_sum = 0
        for holder, qty in holders.items():
            if not isinstance(qty, (int, float)) or int(round(qty)) < 0:
                errors.append(issue("inventory_conservation", "error", f"Item {item_id} holder {holder} has negative quantity."))
                continue
            running_sum += int(round(qty))
        if running_sum != total:
            errors.append(issue("inventory_conservation", "error", f"Item {item_id} total mismatch ({running_sum} != {total})."))

    # Rule 4: unresolved foreshadows due by chapter.
    max_chapter = max_chapter_in_project(project)
    for entry in project.get("foreshadows", []):
        status = str(entry.get("status", "open")).strip().lower()
        if status == "resolved":
            continue
        due_chapter = chapter_number(entry.get("dueChapter"))
        if due_chapter is None:
            continue
        if due_chapter <= max_chapter:
            warnings.append(
                issue(
                    "foreshadow_due",
                    "warning",
                    f"Foreshadow '{entry.get('label', '')}' is overdue (due {entry.get('dueChapter')}).",
                    normalize_chapter_id(entry.get("dueChapter")),
                )
            )

    report = {
        "ranAt": now_iso(),
        "scope": requested_scope,
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }

    return {
        "ok": True,
        "ci_report": report,
    }


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "Empty request."}))
        return 1

    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"Invalid JSON request: {exc}"}))
        return 1

    if not isinstance(request, dict):
        print(json.dumps({"ok": False, "error": "Request must be a JSON object."}))
        return 1

    action = str(request.get("action", "")).strip()

    try:
        if action == "plan_patch":
            response = action_plan_patch(request)
        elif action == "apply_patch":
            response = action_apply_patch(request)
        elif action == "run_ci":
            response = action_run_ci(request)
        elif action == "build_impact":
            response = action_build_impact(request)
        else:
            response = {"ok": False, "error": f"Unknown action: {action}"}
    except Exception as exc:  # noqa: BLE001
        response = {"ok": False, "error": str(exc)}

    print(json.dumps(response, ensure_ascii=True))
    return 0 if response.get("ok", False) else 1


if __name__ == "__main__":
    raise SystemExit(main())
