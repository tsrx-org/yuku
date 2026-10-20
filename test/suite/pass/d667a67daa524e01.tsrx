function App({ n }: { n: number }) @{
	@if (n<=1) {
		<button disabled={n<=0} onClick={() => () => n}>{n<<1}</button>
	}
}