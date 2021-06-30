import { IMiddlewareEvent, IMiddlewareHandler } from "../internal"

const runningActions = new Map<number, { async: boolean; call: IMiddlewareEvent; context: any }>()

export interface IActionTrackingMiddlewareHooks<T> {
    filter?: (call: IMiddlewareEvent) => boolean
    onStart: (call: IMiddlewareEvent) => T
    onResume: (call: IMiddlewareEvent, context: T) => void
    onSuspend: (call: IMiddlewareEvent, context: T) => void
    onSuccess: (call: IMiddlewareEvent, context: T, result: any) => void
    onFail: (call: IMiddlewareEvent, context: T, error: any) => void
}

/**
 * Note: Consider migrating to `createActionTrackingMiddleware2`, it is easier to use.
 *
 * Convenience utility to create action based middleware that supports async processes more easily.
 * All hooks are called for both synchronous and asynchronous actions. Except that either `onSuccess` or `onFail` is called
 *
 * The create middleware tracks the process of an action (assuming it passes the `filter`).
 * `onResume` can return any value, which will be passed as second argument to any other hook. This makes it possible to keep state during a process.
 *
 * See the `atomic` middleware for an example
 *
 * @param hooks
 * @returns
 */
export function createActionTrackingMiddleware<T = any>(
    hooks: IActionTrackingMiddlewareHooks<T>
): IMiddlewareHandler {
    return function actionTrackingMiddleware(
        call: IMiddlewareEvent,
        next: (actionCall: IMiddlewareEvent) => any,
        abort: (value: any) => any
    ) {
        switch (call.type) {
            case "action": {
                if (!hooks.filter || hooks.filter(call) === true) {
                    const context = hooks.onStart(call)
                    hooks.onResume(call, context)
                    runningActions.set(call.id, {
                        call,
                        context,
                        async: false
                    })
                    try {
                        const res = next(call)
                        hooks.onSuspend(call, context)
                        if (runningActions.get(call.id)!.async === false) {
                            runningActions.delete(call.id)
                            hooks.onSuccess(call, context, res)
                        }
                        return res
                    } catch (e) {
                        runningActions.delete(call.id)
                        hooks.onFail(call, context, e)
                        throw e
                    }
                } else {
                    return next(call)
                }
            }
            case "flow_spawn": {
                const root = runningActions.get(call.rootId)!
                root.async = true
                return next(call)
            }
            case "flow_resume":
            case "flow_resume_error": {
                const root = runningActions.get(call.rootId)!
                hooks.onResume(call, root.context)
                try {
                    return next(call)
                } finally {
                    hooks.onSuspend(call, root.context)
                }
            }
            case "flow_throw": {
                const root = runningActions.get(call.rootId)!
                if (call.rootId === call.parentId) {
                    runningActions.delete(call.rootId)
                }
                hooks.onFail(call, root.context, call.args[0])
                return next(call)
            }
            case "flow_return": {
                const root = runningActions.get(call.rootId)!
                if (call.rootId === call.parentId) {
                    runningActions.delete(call.rootId)
                }
                hooks.onSuccess(call, root.context, call.args[0])
                return next(call)
            }
        }
    }
}
