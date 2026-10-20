function App({ n }: { n: number }) @{
	const flags = 1<<n;
	<>{flags <= 4 && <b />}</>
}