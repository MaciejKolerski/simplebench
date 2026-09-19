import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareImages,
  compatibleProfile,
  imageLabel,
  imageInfo,
  imageDescription,
} from "../src/android/settings-model.ts";

const image = (
  level: string,
  tag = "google_apis_playstore",
  revision = "6",
) => ({ id: `system-images;android-${level};${tag};arm64-v8a`, revision });

test("Android selection sorts numeric minor versions and identifies modern 16 KB images", () => {
  const images = [
    image("36.1"),
    image("37.0", "default"),
    image("37.2", "google_apis_playstore_ps16k"),
    image("37.0"),
  ].sort(compareImages);
  assert.equal(imageInfo(images[0]).minorApi, 2);
  assert.match(
    imageLabel(images[0]),
    /Android 17 \(API 37\.2\).*Google Play.*16 KB/,
  );
  assert.match(imageDescription(images[0]), /native libraries/);
  assert.equal(imageInfo(images[1]).tag, "google_apis_playstore");
  assert.equal(imageInfo(images[3]).api, 36);
  assert.match(imageLabel(image("38.0")), /^API 38/);
});

test("phone compatibility includes minor API without inventing an image upgrade", () => {
  const profile = {
    id: "pixel_10",
    name: "Pixel 10",
    width: 1080,
    height: 2424,
    dpi: 420,
    minApi: 36,
    minMinorApi: 1,
  };
  assert.equal(compatibleProfile(profile, image("36")), false);
  assert.equal(compatibleProfile(profile, image("36.1")), true);
  assert.equal(compatibleProfile(profile, image("37.0")), true);
  assert.equal(
    compatibleProfile(
      { ...profile, minApi: 37, minMinorApi: 0 },
      image("36.1"),
    ),
    false,
  );
});
