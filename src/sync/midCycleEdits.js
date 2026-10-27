// Keeps an edit made while a WebDAV or folder sync cycle is in flight (#2233).
//
// The file-tier engine (@glance-apps/sync's createSyncEngine, built in
// adapter.js) reads local state once, merges it with the remote copy, uploads
// the result and THEN applies it, replacing the app's lists whole. Anything the
// user changed between that read and the apply was not in the merge, so the
// apply put the older copy back: a task checked off while the upload was
// running came back unchecked, and a note saved in that window (the notes
// panel saves on blur, so typically the moment the user clicks the next task)
// was lost. The window is the whole upload, seconds on a slow server, and the
// download too when the idle gate built the payload before it. A cycle runs
// five seconds after every edit, so working through a list keeps landing in
// it. The vault tier closes the same window in commitMerge.js.
//
// THE RULE: at apply time, read local state again. If it is still what the
// cycle merged, the merged result applies as it always did. If it moved, merge
// the live state over the merged result with the tier's own merge, so each
// row keeps the newer copy: the mid-cycle edit carries the newer stamp and
// wins, and everything the remote brought in still lands. The edit reaches the
// server on the next cycle, which the edit itself has already armed.
//
// "What the cycle merged" is the last payload built before the apply. The
// engine builds none between its merge and its apply (the upload is handed the
// merged payload), so the last build IS the cycle's local side, whichever of
// the engine's two read points produced it.
//
// Not wired into snapshotFileSync (iCloud, Direct Access): that cycle applies
// in the same task as its merge, and its one early read (the idle gate) only
// proceeds on a file identical to the last settled one, which has nothing for
// the merge to apply.

/**
 * @param {(local: object, remote: object) => {data: object}} merge  the tier's merge
 */
export function createMidCycleEditGuard(merge) {
  let built = null;
  return {
    /** Records a payload the engine is about to merge, and passes it through. */
    noteBuilt(payload) {
      built = payload?.data ? JSON.stringify(payload.data) : null;
      return payload;
    },
    /**
     * What to apply: `merged` itself, or `merged` with the live state's newer
     * rows merged over it when local state moved since the cycle read it.
     */
    reconcile(merged, livePayload) {
      const live = livePayload?.data;
      if (!merged || !live || built === null || JSON.stringify(live) === built) return merged;
      return merge(live, merged).data;
    },
  };
}
