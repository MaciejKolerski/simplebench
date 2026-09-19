import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseDevice,
  parseDevices,
  parsePreferences,
} from "../src/android/types.ts";

const device = {
  id: "01234567-89ab-4def-8abc-0123456789ab",
  name: "My phone",
  image: "system-images;android-36.1;default;arm64-v8a",
  imageRevision: 2,
  profile: "small_phone",
  inputBridge: true,
  hardware: {
    ramMib: 2560,
    cpuCount: 2,
    dataGib: 6,
    gpu: "host",
    quickBoot: false,
  },
};

test("Android preferences and devices retain independent revisions and reject unsupported metadata", () => {
  assert.equal(
    parsePreferences({ version: 1, revision: 4, defaultDeviceId: device.id })
      .revision,
    4,
  );
  assert.equal(
    parseDevices({ version: 1, revision: 8, devices: [device] }).revision,
    8,
  );
  assert.deepEqual(parseDevice(device), device);
  for (const value of [
    { version: 2, revision: 0, defaultDeviceId: null },
    {
      version: 1,
      revision: Number.MAX_SAFE_INTEGER + 1,
      defaultDeviceId: null,
    },
    { version: 1, revision: 0, defaultDeviceId: "other" },
    { version: 1, revision: 0, defaultDeviceId: null, port: 5554 },
  ])
    assert.throws(() => parsePreferences(value));
  assert.throws(
    () => parseDevices({ version: 1, revision: 0, devices: [device, device] }),
    /Duplicate/,
  );
});

test("Android configuration rejects arbitrary paths, process fields and unsafe hardware values", () => {
  for (const update of [
    { id: "../../device" },
    { name: " name " },
    { name: "line\nname" },
    { name: "🦊".repeat(81) },
    { image: "system-images;android-36;../../other;arm64-v8a" },
    { image: "system-images;android-1;default;x86_64" },
    { imageRevision: 0 },
    { profile: "-argument" },
    { profile: "🦊".repeat(41) },
    { inputBridge: "yes" },
    { hardware: { ...device.hardware, ramMib: 511 } },
    { hardware: { ...device.hardware, cpuCount: 2.5 } },
    { hardware: { ...device.hardware, dataGib: 129 } },
    { hardware: { ...device.hardware, gpu: "custom-command" } },
    { pid: 1234 },
    { avdPath: "/another/sdk" },
  ])
    assert.throws(() => parseDevice({ ...device, ...update }));
  assert.equal(
    parseDevice({ ...device, name: "🦊".repeat(80) }).name.length,
    160,
  );
});
