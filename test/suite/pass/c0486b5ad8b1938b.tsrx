{
						using handle: Disposable = open();
					}
					async function load() {
						await using connection: AsyncDisposable = await connect(), other = g();
					}