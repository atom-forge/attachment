import type { EventEmitter } from '../events/types.js';

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
