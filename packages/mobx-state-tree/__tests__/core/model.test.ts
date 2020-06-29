import { applySnapshot, types } from "../../src"

test("it should call preProcessSnapshot with the correct argument", () => {
    const onSnapshot = jest.fn((snapshot: any) => {
        return {
            val: snapshot.val + 1
        }
    })

    const Model = types
        .model({
            val: types.number
        })
        .preProcessSnapshot(onSnapshot)

    const model = Model.create({ val: 0 })
    applySnapshot(model, { val: 1 })
    expect(onSnapshot).lastCalledWith({ val: 1 })
})
