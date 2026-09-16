import type { SiteRegistration, SourceKey, SourceScope } from "@reportingdash/site-seo-contract";

export type SiteScopeClaim = Readonly<{ dashboardId: number; siteId: string }>;

export class MissingSourceScopeError extends Error {
  constructor(sourceKey: SourceKey) {
    super(`No configured scope for ${sourceKey}`);
    this.name = "MissingSourceScopeError";
  }
}

export async function resolveSourceScope(
  registration: SiteRegistration,
  claim: SiteScopeClaim,
  sourceKey: SourceKey,
): Promise<SourceScope> {
  if (
    claim.dashboardId !== registration.profile.dashboardId ||
    claim.siteId !== registration.profile.siteId
  ) {
    throw new Error("Authenticated site scope does not match this profile");
  }

  const binding = registration.bindings.find((candidate) =>
    candidate.sourceKey === sourceKey &&
    candidate.bindingId === registration.profile.sources.find(
      (source) => source.sourceKey === sourceKey,
    )?.bindingId &&
    candidate.dashboardId === claim.dashboardId &&
    candidate.siteId === claim.siteId &&
    candidate.clientId === registration.profile.clientId,
  );
  if (!binding) throw new MissingSourceScopeError(sourceKey);
  return binding;
}
