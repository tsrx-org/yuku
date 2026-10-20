export function App(props: { failed: boolean }) @{
	<Boundary fallback={(reset: () => void) => <button onClick={() => reset()}>{'retry'}</button>}>
		<Child failed={props.failed} />
	</Boundary>
}