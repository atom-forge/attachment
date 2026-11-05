import type { EventEmitter } from '../events/types.js';

/**
 * Prisma Client extension that fires `entity:deleted` after every successful
 * single-record `delete`, so attachment cleanup (`purge()`) can be wired to it.
 *
 * ```ts
 * const prisma = new PrismaClient().$extends(createPrismaExtension(eventManager));
 * ```
 *
 * `deleteMany` is not covered: Prisma returns only a count, not the deleted records.
 * Load the records and purge their attachments yourself before a `deleteMany`.
 */
export function createPrismaExtension(eventManager: EventEmitter) {
	return {
		name: '@atom-forge/attachment',
		query: {
			$allModels: {
				async delete({ model, args, query }: { model: string; args: unknown; query: (args: unknown) => Promise<unknown> }) {
					const result = await query(args);
					eventManager.trigger({ type: 'entity:deleted', model, entity: result as any });
					return result;
				},
			},
		},
	};
}

/**
 * @deprecated `prisma.$use` middleware is deprecated in Prisma 4.16 and removed in newer
 * Prisma versions. Use `prisma.$extends(createPrismaExtension(eventManager))` instead.
 */
export function createPrismaMiddleware(eventManager: EventEmitter) {
	return async (params: any, next: (params: any) => Promise<any>) => {
		const result = await next(params);
		if (params.action === 'delete' && params.model) {
			eventManager.trigger({
				type:   'entity:deleted',
				model:  params.model,
				entity: result,
			});
		}
		return result;
	};
}
