export function App() {
	return <Card
		content={
			<div>
				@if (foo) {
					<span />
				}
			</div>
		}
	/>;
}