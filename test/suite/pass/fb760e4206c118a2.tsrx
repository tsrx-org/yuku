function App() { return <div>@{
			class List<T> {
				items: T[];
			}
			class Containers {
				static List<T>() {
					return new List<T>();
				}
			}
			const c = Containers.List<string>();
			<>{c}</>
		}</div>; }