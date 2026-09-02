const view = (
    <section>
        before
        @{ const label = "ready"; const count = 1; }
        after
    </section>
);

const rendered = (
    <section>
        @{ const label = "ready"; <span>{label}</span> }
    </section>
);

export { view, rendered };

const counted = @{
    const count = get()
    <button>{'Count: ' + count}</button>
};

const wide = a < b
<main>{wide}</main>

const useValue =
<T extends Value,>(value: T): T => value
<main>{useValue(1)}</main>
