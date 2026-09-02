import { vi } from "vitest";

import type { PermissionsService } from "#src/service";

/**
 * A fully-stubbed {@link PermissionsService} for tests that need a service
 * instance without exercising any of its behavior — publication and locator
 * tests, lifecycle wiring, and the ancestor-node lookups.
 *
 * Every member is a bare `vi.fn()`; pass `overrides` for the one or two a test
 * actually drives. Keeping the roster here means a new required member of the
 * interface is added in one place rather than in every suite that fakes one.
 */
export function makeFakePermissionsService(
  overrides: Partial<PermissionsService> = {},
): PermissionsService {
  return {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
    isToolFullyDenied: vi.fn(),
    registerToolInputFormatter: vi.fn(),
    registerToolAccessExtractor: vi.fn(),
    getToolAccessExtractor: vi.fn(),
    getToolInputFormatter: vi.fn(),
    registerAuthorizer: vi.fn(),
    ...overrides,
  };
}
