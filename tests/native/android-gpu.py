"""Summarize only owned GPU intervals from a developer-only Metal System Trace."""
import argparse
import json
import pathlib
import xml.etree.ElementTree as ET


def summarize(intervals_path, toc_path, resources_path):
    duration = float(ET.parse(toc_path).findtext(".//duration"))
    if not 0 < duration <= 60:
        raise ValueError("Expected a bounded GPU trace of at most one minute")
    groups = json.loads(pathlib.Path(resources_path).read_text())["summary"]["groups"]
    document = ET.parse(intervals_path)
    schema = document.find(".//schema")
    if schema is None or schema.get("name") != "metal-gpu-intervals":
        raise ValueError("Unexpected Instruments export schema")
    columns = {column.findtext("mnemonic"): i for i, column in enumerate(schema)}
    for name in ("start", "duration", "process", "state", "channel-name"):
        if name not in columns:
            raise ValueError("Missing Instruments column: " + name)
    identifiers = {element.get("id"): element for element in document.iter()
                   if element.get("id") is not None}

    def resolve(element):
        return identifiers[element.get("ref")] if element.get("ref") else element

    intervals = {group: [] for group in groups}
    channels = {group: {} for group in groups}
    for row in document.iter("row"):
        children = list(row)
        process = resolve(children[columns["process"]])
        pid_element = process.find("pid")
        if pid_element is None:
            continue
        pid = int(resolve(pid_element).text)
        owned = [group for group, data in groups.items() if pid in data["pids"]]
        if not owned or resolve(children[columns["state"]]).text != "Active":
            continue
        start = int(resolve(children[columns["start"]]).text)
        elapsed = int(resolve(children[columns["duration"]]).text)
        stop = min(start + elapsed, round(duration * 1e9))
        start = max(0, start)
        if stop <= start:
            continue
        channel = resolve(children[columns["channel-name"]]).text
        for group in owned:
            intervals[group].append((start, stop))
            channels[group][channel] = channels[group].get(channel, 0) + stop - start
    result = {}
    for group, values in intervals.items():
        end = total = 0
        for start, stop in sorted(values):
            total += max(0, stop - max(start, end))
            end = max(end, stop)
        result[group] = dict(
            pids=groups[group]["pids"], unionActiveMs=total / 1e6,
            activeSecondsPerSecond=total / 1e9 / duration,
            channelMs={name: value / 1e6 for name, value in channels[group].items()},
            intervals=len(values))
    return dict(durationSeconds=duration, groups=result,
                metric="Union of active GPU intervals per group; not GPU core utilization")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("intervals")
    parser.add_argument("toc")
    parser.add_argument("resources")
    parser.add_argument("output")
    arguments = parser.parse_args()
    value = summarize(arguments.intervals, arguments.toc, arguments.resources)
    with open(arguments.output, "x") as output:
        json.dump(value, output, indent=2)
    print(json.dumps(value, indent=2))
