function App() { return <div>@{
			const label = 'value';
			const builder = function <T>() {
				return label as T;
			};
			<T>{builder<string>()}</T>
		}</div>; }