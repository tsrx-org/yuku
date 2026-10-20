export function App() @{
	<main>
		@switch (x) {
			@case 1: {
				const a = <div><b>1</b> 2<i /></div>;
				<p>{a}</p>
			}
		}
	</main>
}