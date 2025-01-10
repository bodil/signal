import { sleep } from "@bodil/core/async";
import { expect, test } from "vitest";
import { asyncComputed, effect, signal } from ".";

test("Signal", async () => {
    const sig = signal(0);
    const result: Array<number> = [];
    effect(() => void result.push(sig.value));
    expect(result).toEqual([0]);
    sig.value = 1;
    sig.value = 2;
    sig.value = 3;
    expect(result).toEqual([0]);
    const done = Promise.withResolvers<void>();
    setTimeout(() => {
        try {
            expect(result).toEqual([0, 3]);
            done.resolve();
        } catch (e) {
            done.reject(e as Error);
        }
    }, 1);
    await done.promise;
});

test("signal equality", async () => {
    const result: Array<number> = [];
    const sig = signal(0);
    effect(() => void result.push(sig.value));
    expect(result).toEqual([0]);
    sig.value = 1;
    await sleep(1);
    expect(result).toEqual([0, 1]);
    sig.value = 1;
    await sleep(1);
    expect(result).toEqual([0, 1]);
    sig.value = 2;
    await sleep(1);
    expect(result).toEqual([0, 1, 2]);
    sig.value = 2;
    await sleep(1);
    expect(result).toEqual([0, 1, 2]);
    sig.value = 3;
    await sleep(1);
    expect(result).toEqual([0, 1, 2, 3]);
    sig.value = 3;
    await sleep(1);
    expect(result).toEqual([0, 1, 2, 3]);
    sig.value = 2;
    await sleep(1);
    expect(result).toEqual([0, 1, 2, 3, 2]);
});

test("asyncComputed", async () => {
    const s = signal(1);
    const c = await asyncComputed(() => Promise.resolve(s.value + 1));
    expect(c.value).toEqual(2);
    try {
        await asyncComputed(() => {
            throw new Error("welp!");
        });
        throw new Error("computed error failed to throw");
    } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toEqual("welp!");
    }
    s.value = 2;
    expect(c.value).toEqual(2);
    await sleep(1);
    expect(c.value).toEqual(3);
    s.value = 1;
    s.value = 2;
    s.value = 3;
    expect(c.value).toEqual(3);
    await sleep(1);
    expect(c.value).toEqual(4);
});
