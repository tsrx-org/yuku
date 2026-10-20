export function App() @{
	<ul>
		@for (const item of items; index i; key item.id) {
			<li>{i}</li>
		}
	</ul>
}