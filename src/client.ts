export type {
	AttachmentItem,
	AttachmentData,
	Focus,
	ImgStat,
	ImageVariantDef,
	ImageVariantMap,
	Density,
} from './types.js';
export { AttachmentValidationError, encodeFocus, decodeFocus } from './types.js';
export { buildImageUrl, buildVariantUrl } from './image/image-url.js';
export {
	makeAttachmentHandler,
	type ImgVariants,
	type ItemView,
	type CategoryView,
	type AttachmentHandlerFor,
	type AttachmentHandlerOptions,
} from './client-handler.js';