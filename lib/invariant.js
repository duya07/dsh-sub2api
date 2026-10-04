
//#region src/invariant.ts
function invariant(condition, message) {
	if (!condition) throw new Error(`dsh-sub2api: ${message}`);
}
var invariant_default = invariant;

//#endregion
export { invariant_default as default, invariant };