export function App() @{
	<Host on={(cb: () => void) => 'x'} id="after">
		<Sibling />
	</Host>
}