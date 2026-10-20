export function App({ c, A, B }) @{
	<main>
		<{c ? A : B}>
			<p>{c}</p>
		</{c ? A : B}>
		<{getTag()} />
		<{Tag} />
	</main>
}

export const after = <{props?.as}>x</{props?.as}>;

export function Later() @{
	<p>later</p>
}