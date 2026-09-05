import type { AccessIntent } from "#src/access-intent/access-intent";
import { buildAccessIntentForSurface } from "#src/access-intent/input-normalizer";
import type { Authorizer } from "#src/authority/authorizer";
import type { AuthorizerRegistrar } from "#src/authority/authorizer-registry";
import type { PathNormalizer } from "#src/path/path-normalizer";
import type { PermissionsService } from "#src/service";
import type {
  ToolAccessExtractor,
  ToolAccessExtractorLookup,
  ToolAccessExtractorRegistrar,
} from "#src/tool-input/tool-access-extractor-registry";
import type {
  ToolInputFormatter,
  ToolInputFormatterLookup,
  ToolInputFormatterRegistrar,
} from "#src/tool-input/tool-input-formatter-registry";
import type { PermissionCheckResult, PermissionState } from "#src/types";
import { resolveBashAdvisoryCheck } from "./bash-advisory-check";

/**
 * Resolution surface the service needs: answer a gate-style {@link AccessIntent}
 * (composing the session ruleset internally) and report a tool-level state.
 * `PermissionResolver` satisfies it.
 */
interface ResolverForService {
  resolve(intent: AccessIntent): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
  isToolFullyDenied(toolName: string, agentName?: string): boolean;
}

/** Narrow session view: hands out the cwd-bound path normalizer. */
interface PathNormalizerProvider {
  getPathNormalizer(): PathNormalizer;
}

/**
 * In-process implementation of the cross-extension {@link PermissionsService}.
 *
 * Constructed once in the composition root and backed by the single shared
 * `PermissionResolver` and `PermissionSession` that the gates also use — so
 * service queries and gate-path decisions see the same state. Path-shaped
 * surface queries route through the resolver as an `access-path` intent, so
 * they match the lexical aliases ∪ canonical (symlink-resolved) set the gates
 * do (#503); non-path surfaces stay on the `tool` intent.
 */
export class LocalPermissionsService implements PermissionsService {
  constructor(
    private readonly resolver: ResolverForService,
    private readonly session: PathNormalizerProvider,
    private readonly formatterRegistry: ToolInputFormatterRegistrar &
      ToolInputFormatterLookup,
    private readonly accessExtractorRegistry: ToolAccessExtractorRegistrar &
      ToolAccessExtractorLookup,
    private readonly authorizerRegistry: AuthorizerRegistrar,
  ) {}

  checkPermission(
    surface: string,
    value?: string,
    agentName?: string,
  ): ReturnType<PermissionsService["checkPermission"]> {
    // Bash decomposes at gate parity: a chained/nested command is split into
    // its command-pattern units and resolved most-restrictive, matching what
    // the enforcement gate enforces (#309). A cold parser falls back to the
    // whole-string match inside resolveBashAdvisoryCheck.
    if (surface === "bash") {
      return resolveBashAdvisoryCheck(value ?? "", agentName, this.resolver);
    }
    const intent = buildAccessIntentForSurface(
      surface,
      value,
      this.session.getPathNormalizer(),
      agentName,
    );
    return this.resolver.resolve(intent);
  }

  getToolPermission(
    toolName: string,
    agentName?: string,
  ): ReturnType<PermissionsService["getToolPermission"]> {
    return this.resolver.getToolPermission(toolName, agentName);
  }

  isToolFullyDenied(
    toolName: string,
    agentName?: string,
  ): ReturnType<PermissionsService["isToolFullyDenied"]> {
    return this.resolver.isToolFullyDenied(toolName, agentName);
  }

  registerToolInputFormatter(
    toolName: string,
    formatter: ToolInputFormatter,
  ): ReturnType<PermissionsService["registerToolInputFormatter"]> {
    return this.formatterRegistry.register(toolName, formatter);
  }

  registerToolAccessExtractor(
    toolName: string,
    extractor: ToolAccessExtractor,
  ): ReturnType<PermissionsService["registerToolAccessExtractor"]> {
    return this.accessExtractorRegistry.register(toolName, extractor);
  }

  getToolAccessExtractor(
    toolName: string,
  ): ReturnType<PermissionsService["getToolAccessExtractor"]> {
    // The origin is the gates' concern, not a caller's: this surface answers
    // the capability, and where it came from rides the gate's log context.
    return this.accessExtractorRegistry.resolve(toolName)?.extractor;
  }

  getToolInputFormatter(
    toolName: string,
  ): ReturnType<PermissionsService["getToolInputFormatter"]> {
    return this.formatterRegistry.get(toolName);
  }

  registerAuthorizer(
    name: string,
    authorize: Authorizer["authorize"],
  ): ReturnType<PermissionsService["registerAuthorizer"]> {
    return this.authorizerRegistry.register(name, authorize);
  }
}
