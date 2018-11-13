import {
    types,
    IJsonPatch,
    IStateTreeNode,
    IMiddlewareEvent,
    recordPatches,
    IPatchRecorder,
    createActionTrackingMiddleware,
    getEnv,
    hasEnv,
    getRoot,
    applyPatch,
    flow,
    addMiddleware
} from "mobx-state-tree"
import { IObservableArray } from "mobx"

const Entry = types.model("UndoManagerEntry", {
    patches: types.frozen<ReadonlyArray<IJsonPatch>>(),
    inversePatches: types.frozen<ReadonlyArray<IJsonPatch>>()
})

const UndoManager = types
    .model("UndoManager", {
        history: types.array(Entry),
        undoIdx: 0
    })
    .views(self => ({
        get canUndo() {
            return self.undoIdx > 0
        },
        get canRedo() {
            return self.undoIdx < self.history.length
        }
    }))
    .actions(self => {
        let skipping = false
        let flagSkipping = false
        let targetStore: IStateTreeNode
        let replaying = false
        let middlewareDisposer: () => void
        let grouping = false
        let groupRecorder: any = {
            patches: [] as ReadonlyArray<IJsonPatch>,
            inversePatches: [] as ReadonlyArray<IJsonPatch>
        }
        let recordingActionId: any = null
        let recordingActionLevel = 0

        const startRecordAction = (call: IMiddlewareEvent): any => {
            // level for the case that actions have the same name
            skipping = flagSkipping
            recordingActionLevel++
            const actionId = call.name + recordingActionLevel
            recordingActionId = actionId
            return { recorder: recordPatches(call.tree), actionId }
        }
        const stopRecordingAction = (recorder: IPatchRecorder): void => {
            recordingActionId = null
            if (!skipping) {
                if (grouping) return cachePatchForGroup(recorder)
                ;(self as any).addUndoState(recorder)
            }
            skipping = flagSkipping
        }
        const cachePatchForGroup = (recorder: IPatchRecorder): void => {
            groupRecorder = {
                patches: groupRecorder.patches.concat(recorder.patches),
                inversePatches: groupRecorder.inversePatches.concat(recorder.inversePatches)
            }
        }
        const undoRedoMiddleware = createActionTrackingMiddleware({
            // the flagSkipping === false check is mainly a performance optimisation
            filter: call => flagSkipping === false && call.context !== self, // don't undo / redo undo redo :)
            onStart: call => {
                if (!recordingActionId) {
                    return startRecordAction(call)
                }
            },
            onResume: (
                call,
                { recorder, actionId }: { recorder: any; actionId: any } = {
                    recorder: undefined,
                    actionId: undefined
                }
            ) => recorder && recorder.resume(),
            onSuspend: (
                call,
                { recorder, actionId }: { recorder: any; actionId: any } = {
                    recorder: undefined,
                    actionId: undefined
                }
            ) => recorder && recorder.stop(),
            onSuccess: (
                call,
                { recorder, actionId }: { recorder: any; actionId: any } = {
                    recorder: undefined,
                    actionId: undefined
                }
            ) => {
                if (recordingActionId === actionId) {
                    stopRecordingAction(recorder)
                }
            },
            onFail: (
                call,
                { recorder, actionId }: { recorder: any; actionId: any } = {
                    recorder: undefined,
                    actionId: undefined
                }
            ) => recorder && recorder.undo()
        })

        return {
            addUndoState(recorder: any) {
                if (replaying || (recorder.patches && recorder.patches.length === 0)) {
                    // skip recording if this state was caused by undo / redo
                    // or if patches is empty
                    return
                }
                self.history.splice(self.undoIdx)
                self.history.push({
                    patches: recorder.patches,
                    inversePatches: recorder.inversePatches
                })
                self.undoIdx = self.history.length
            },
            afterCreate() {
                targetStore = hasEnv(self) ? getEnv(self).targetStore : getRoot(self)
                if (!targetStore || targetStore === self)
                    throw new Error(
                        "UndoManager should be created as part of a tree, or with `targetStore` in it's environment"
                    )
                middlewareDisposer = addMiddleware(targetStore, undoRedoMiddleware, false)
            },
            beforeDestroy() {
                middlewareDisposer()
            },
            undo() {
                replaying = true
                self.undoIdx--
                // n.b: reverse patches back to forth
                // TODO: add error handling when patching fails? E.g. make the operation atomic?
                applyPatch(
                    getRoot(targetStore),
                    self.history[self.undoIdx].inversePatches!.slice().reverse()
                )
                replaying = false
            },
            redo() {
                replaying = true
                // TODO: add error handling when patching fails? E.g. make the operation atomic?
                applyPatch(getRoot(targetStore), self.history[self.undoIdx].patches)
                self.undoIdx++
                replaying = false
            },
            withoutUndo(fn: () => any) {
                try {
                    skipping = true
                    flagSkipping = true
                    return fn()
                } finally {
                    flagSkipping = false
                }
            },
            withoutUndoFlow(generatorFn: () => any) {
                return flow(function*() {
                    skipping = true
                    flagSkipping = true
                    const result = yield* generatorFn()
                    flagSkipping = false
                    return result
                })
            },
            startGroup(fn: () => any) {
                grouping = true
                return fn()
            },
            stopGroup(fn?: () => any) {
                if (fn) fn()
                grouping = false
                this.addUndoState(groupRecorder)
                groupRecorder = { patches: [], inversePatches: [] }
            }
        }
    })

export default UndoManager
