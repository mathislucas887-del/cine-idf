import os
os.environ.setdefault("TMDB_API_KEY", "test-only")
os.environ.pop("GIST_TOKEN", None)
os.environ.pop("GIST_ID", None)
