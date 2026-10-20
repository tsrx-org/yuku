function App() {
			return <main>
				@if (props.foo()) {
					<span>{props.foo()}</span>
				}
				@if (props.bar()) {
					<span>{props.bar()}</span>
				}
			</main>;
		}