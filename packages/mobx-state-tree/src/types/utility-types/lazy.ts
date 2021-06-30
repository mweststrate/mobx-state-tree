import { action, IObservableArray, observable, when } from "mobx"
import { AnyNode } from "../../core/node/BaseNode"
import { IType } from "../../core/type/type"
import {
    IValidationContext,
    IValidationResult,
    TypeFlags,
    typeCheckSuccess,
    AnyObjectNode,
    SimpleType,
    createScalarNode,
    deepFreeze,
    isSerializable,
    typeCheckFailure
} from "../../internal"

interface LazyOptions<T extends IType<any, any, any>, U> {
    loadType: () => Promise<T>
    shouldLoadPredicate: (parent: U) => boolean
}

export function lazy<T extends IType<any, any, any>, U>(
    name: string,
    options: LazyOptions<T, U>
): T {
    // TODO: fix this unknown casting to be stricter
    return (new Lazy(name, options) as unknown) as T
}

/**
 * @internal
 * @hidden
 */
export class Lazy<T extends IType<any, any, any>, U> extends SimpleType<T, T, T> {
    flags = TypeFlags.Lazy

    private loadedType: T | null = null
    private pendingNodeList: IObservableArray<AnyNode> = observable.array()

    constructor(name: string, private readonly options: LazyOptions<T, U>) {
        super(name)

        when(
            () =>
                this.pendingNodeList.length > 0 &&
                this.pendingNodeList.some(
                    (node) =>
                        node.isAlive &&
                        this.options.shouldLoadPredicate(node.parent ? node.parent.value : null)
                ),
            () => {
                this.options.loadType().then(
                    action((type: T) => {
                        this.loadedType = type
                        this.pendingNodeList.forEach((node) => {
                            if (!node.parent) return
                            if (!this.loadedType) return

                            node.parent.applyPatches([
                                {
                                    op: "replace",
                                    path: `/${node.subpath}`,
                                    value: node.snapshot
                                }
                            ])
                        })
                    })
                )
            }
        )
    }

    describe() {
        return `<lazy ${this.name}>`
    }

    instantiate(
        parent: AnyObjectNode | null,
        subpath: string,
        environment: any,
        value: this["C"]
    ): this["N"] {
        if (this.loadedType) {
            return this.loadedType.instantiate(parent, subpath, environment, value) as this["N"]
        }

        const node = createScalarNode(this, parent, subpath, environment, deepFreeze(value))
        this.pendingNodeList.push(node)

        when(
            () => !node.isAlive,
            () => this.pendingNodeList.splice(this.pendingNodeList.indexOf(node), 1)
        )

        return node
    }

    isValidSnapshot(value: this["C"], context: IValidationContext): IValidationResult {
        if (this.loadedType) {
            return this.loadedType.validate(value, context)
        }
        if (!isSerializable(value)) {
            return typeCheckFailure(context, value, "Value is not serializable and cannot be lazy")
        }
        return typeCheckSuccess()
    }

    reconcile(current: this["N"], value: T, parent: AnyObjectNode, subpath: string): this["N"] {
        if (this.loadedType) {
            current.die()
            return this.loadedType.instantiate(
                parent,
                subpath,
                parent.environment,
                value
            ) as this["N"]
        }
        return super.reconcile(current, value, parent, subpath)
    }
}
