import { Signal } from "signal-polyfill";
import { toDisposable, type Disposifiable } from "@bodil/disposable";
import { Err, Ok, type Result, Async } from "@bodil/core";

interface ISignal<A> {
    readonly value: A;
    map<B>(fn: (value: A) => B): Computed<B>;
    on(callback: (value: A) => void): Disposable;
}

class State<A> extends Signal.State<A> implements ISignal<A> {
    get value(): A {
        return this.get();
    }

    set value(value: A) {
        this.set(value);
    }

    update(fn: (value: A) => A): void {
        this.set(Signal.subtle.untrack(() => fn(this.get())));
    }

    readOnly(): Computed<A> {
        return AnySignal.computed(() => this.get());
    }

    map<B>(fn: (value: A) => B): Computed<B> {
        return AnySignal.computed(() => fn(this.get()));
    }

    on(callback: (value: A) => void): Disposable {
        return AnySignal.subscribe(this, callback);
    }

    static is(v: unknown): v is State<unknown> {
        return v instanceof State;
    }
}

class Computed<A> extends Signal.Computed<A> implements ISignal<A> {
    get value(): A {
        return this.get();
    }

    map<B>(fn: (value: A) => B): Computed<B> {
        return AnySignal.computed(() => fn(this.get()));
    }

    on(callback: (value: A) => void): Disposable {
        return AnySignal.subscribe(this, callback);
    }

    static is(v: unknown): v is Computed<unknown> {
        return v instanceof Computed;
    }
}

let effectNeedsEnqueue = true;
const effectWatcher = new Signal.subtle.Watcher(() => {
    if (effectNeedsEnqueue) {
        effectNeedsEnqueue = false;
        queueMicrotask(effectProcess);
    }
});

function effectProcess(): void {
    effectNeedsEnqueue = true;
    for (const sig of effectWatcher.getPending()) {
        sig.get();
    }
    effectWatcher.watch();
}

type AnySignal<A> = State<A> | Computed<A>;

const AnySignal = Object.assign(
    function <A>(value: A, options?: Signal.Options<A>): State<A> {
        return new State(value, options);
    },
    {
        is(v: unknown): v is AnySignal<unknown> {
            return State.is(v) || Computed.is(v);
        },

        computed<A>(fn: (this: Computed<A>) => A, options?: Signal.Options<A>): Computed<A> {
            return new Computed(fn, options);
        },

        subscribe<A>(signal: ISignal<A>, callback: (value: A) => void): Disposable {
            return AnySignal.effect(() => callback(signal.value));
        },

        effect(fn: () => Disposifiable | void): Disposable {
            let cleanup: Disposable | undefined;
            const computed = new Computed(() => {
                if (cleanup !== undefined) {
                    cleanup[Symbol.dispose]();
                }
                const result = fn();
                cleanup = result !== undefined ? toDisposable(result) : undefined;
            });
            effectWatcher.watch(computed);
            computed.get();
            return toDisposable(() => {
                effectWatcher.unwatch(computed);
                if (cleanup !== undefined) {
                    cleanup[Symbol.dispose]();
                }
            });
        },

        asyncComputed<A>(
            fn: (abort: AbortSignal) => Promise<A>,
            options?: Signal.Options<A>
        ): Promise<Computed<A>> {
            const result = Promise.withResolvers<Computed<A>>();
            const stream = AnySignal.computed(() => Async.abortable(fn));
            const sig: State<Result<A, Error>> = AnySignal(Err(new Error()));
            let job: Async.AbortableJob<A> | undefined = undefined;
            let resolved = false;
            const resolve = () => {
                if (!resolved) {
                    resolved = true;
                    result.resolve(AnySignal.computed(() => sig.get().unwrapExact(), options));
                }
            };
            AnySignal.effect(() => {
                if (job !== undefined) {
                    job.abort();
                }
                job = stream.get();
                job.result.then(
                    (next) => {
                        sig.set(Ok(next));
                        resolve();
                    },
                    (error) => {
                        if (job?.signal.aborted === true) {
                            return;
                        }
                        sig.set(Err(error));
                        resolve();
                    }
                );
            });
            return result.promise;
        },

        State,
        Computed,
        subtle: Signal.subtle,
    }
);

export { AnySignal as Signal };
