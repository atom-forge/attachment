// ---------------------------------------------------------------------------
// Path-segment validation
//
// Group ids and filenames end up in storage paths ({shard}/{groupId}/{filename}),
// so both must be single, non-traversing path segments.
// ---------------------------------------------------------------------------

/** Group id: letters, digits, '_' and '-', starting with a letter or digit (no dots, no slashes). */
const GROUP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isSafeGroupId(groupId: string): boolean {
	return GROUP_ID_PATTERN.test(groupId);
}

/** Filename: one path segment, not '.' or '..', no slashes, backslashes or control characters. */
export function isSafeFilename(filename: string): boolean {
	return filename.length > 0
		&& filename !== '.'
		&& filename !== '..'
		&& !/[/\\\u0000-\u001f\u007f]/.test(filename);
}
