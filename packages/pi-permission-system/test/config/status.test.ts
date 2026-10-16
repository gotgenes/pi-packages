import { expect, test } from "vitest";
import {
  PERMISSION_SYSTEM_STATUS_KEY,
  syncYoloStatus,
  yoloStatusValue,
} from "#src/config/status";
import { makeCtx } from "#test/helpers/handler-fixtures";

test("The status value follows the effective yolo state", () => {
  expect(yoloStatusValue(false)).toBe(undefined);
  expect(yoloStatusValue(true)).toBe("yolo");
});

test("syncYoloStatus writes the key with the value, or clears it", () => {
  const on = makeCtx({ hasUI: true });
  syncYoloStatus(on, true);
  expect(on.ui.setStatus).toHaveBeenCalledWith(
    PERMISSION_SYSTEM_STATUS_KEY,
    "yolo",
  );

  const off = makeCtx({ hasUI: true });
  syncYoloStatus(off, false);
  expect(off.ui.setStatus).toHaveBeenCalledWith(
    PERMISSION_SYSTEM_STATUS_KEY,
    undefined,
  );
});
