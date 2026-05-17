import type { AttachmentData } from '../types.js';

export interface EventEmitter {
	trigger(event: AttachmentEvent): void;
}

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

interface BaseAttachmentEvent {
	entityType: string;
	entityId:   string;
	category:   string;
	groupId:    string;
}

// ---------------------------------------------------------------------------
// defineAttachments events
// ---------------------------------------------------------------------------

export interface AttachmentAddEvent extends BaseAttachmentEvent {
	type:       'attachment:add';
	attachment: AttachmentData;
}

export interface AttachmentReplaceEvent extends BaseAttachmentEvent {
	type:          'attachment:replace';
	oldAttachment: AttachmentData;
	attachment:    AttachmentData;
}

export interface AttachmentDeleteEvent extends BaseAttachmentEvent {
	type:     'attachment:delete';
	filename: string;
}

export interface AttachmentRenameEvent extends BaseAttachmentEvent {
	type:    'attachment:rename';
	oldName: string;
	newName: string;
}

export interface AttachmentMetaUpdatedEvent extends BaseAttachmentEvent {
	type:       'attachment:meta-updated';
	attachment: AttachmentData;
}

export interface AttachmentPurgeEvent {
	type:       'attachment:purge';
	entityType: string;
	entityId:   string;
}

// ---------------------------------------------------------------------------
// Prisma middleware event
// ---------------------------------------------------------------------------

export interface EntityDeletedEvent {
	type:   'entity:deleted';
	model:  string;
	entity: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Storage provider events
// ---------------------------------------------------------------------------

export interface StorageRenameCleanupFailedEvent {
	type:     'storage:rename-cleanup-failed';
	oldPath:  string;
	newPath:  string;
	error:    unknown;
}

// ---------------------------------------------------------------------------
// Image server events (optional)
// ---------------------------------------------------------------------------

export interface ThumbnailGeneratedEvent {
	type:     'thumbnail:generated';
	groupId:  string;
	filename: string;
	modeSeg:  string;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type AttachmentEvent =
	| AttachmentAddEvent
	| AttachmentReplaceEvent
	| AttachmentDeleteEvent
	| AttachmentRenameEvent
	| AttachmentMetaUpdatedEvent
	| AttachmentPurgeEvent
	| EntityDeletedEvent
	| StorageRenameCleanupFailedEvent
	| ThumbnailGeneratedEvent;
