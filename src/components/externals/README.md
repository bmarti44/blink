# What are these externals for?...

These files are a way to both lazy load and tree shake components from external libraries.
The idea is to re-export heavy/large components/libraries here, and then dynamically import
them into other files in your codebase.

This gives two benefits ->

1. The large library is lazy loaded, and not a part of your entrypoint (main) bundle.
2. The large library is tree shaken, and all unused dependencies are removed.

This solution is described in much more detail here -> [here](https://medium.com/@christiango/the-unexpected-impact-of-dynamic-imports-on-tree-shaking-ddadeb135dd7)
