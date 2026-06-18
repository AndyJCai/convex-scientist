"use client";

import type { Id } from "@/convex/_generated/dataModel";

export type Artifact = {
  _id: Id<"artifacts">;
  name: string;
  contentType: string;
  size: number;
  _creationTime: number;
  kind?: "uploaded" | "generated";
  // The agent message this file was sent with, if any. Absent = still pending
  // in the composer (uploaded but not yet sent) or a generated artifact.
  messageId?: string;
  // A resolved download/preview URL for the stored blob (from listArtifacts /
  // listArtifactsForProject). Null if the blob is missing; absent in contexts
  // that don't fetch it.
  url?: string | null;
};
