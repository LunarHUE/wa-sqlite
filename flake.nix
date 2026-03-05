{
  description = "sqwab - custom SQLite WASM and wa-sqlite builds";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    wa-sqlite-src = {
      url = "github:rhashimoto/wa-sqlite";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, wa-sqlite-src }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Helper: build tools shared across both packages
        commonBuildInputs = with pkgs; [
          emscripten   # Changed from emscriptenWrapped
          gnumake
          nodejs
          python3
        ];

      in
      {
        packages = {

          # ---------------------------------------------------------------------------
          # Package 1: Official SQLite WASM build
          # ---------------------------------------------------------------------------
          sqlite-wasm = pkgs.stdenv.mkDerivation rec {
            pname = "sqlite-wasm";
            version = "release";

            # The SQLite fossil tarball. After first run Nix will tell you the real
            # hash — replace lib.fakeHash below with the printed sha256 value.
            src = pkgs.fetchurl {
              name = "sqlite-src.tar.gz";
              url = "https://www.sqlite.org/src/tarball/sqlite.tar.gz?r=release";
              hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; # replace with real hash
            };

            nativeBuildInputs = commonBuildInputs ++ (with pkgs; [
              autoconf
              automake
              libtool
              tcl
              curl
            ]);

            # Nix unpacks tarballs automatically; SQLite's tarball extracts to a
            # directory named "sqlite". The build runs from there.
            sourceRoot = "sqlite";

            postUnpack = ''
              # Apply overlay files on top of the unpacked source tree
              cp -r --no-preserve=mode ${self}/overlay.sqlite/. sqlite/
            '';

            configurePhase = ''
              runHook preConfigure
              export EM_CACHE=$TMPDIR/emscripten-cache
              mkdir -p $EM_CACHE
              ./configure --enable-all
              runHook postConfigure
            '';

            buildPhase = ''
              runHook preBuild
              export PATH="$PWD/.nix-fake-bin:$PATH"

              # -fexceptions: Fixes the WASM linker error
              # -s USE_ES6_IMPORT_META=0: Removes import.meta.url for bundler compatibility
              # -g: Prevents Emscripten from minifying the output JS
              export EMCC_CFLAGS="-fexceptions -s USE_ES6_IMPORT_META=0 -g"

              make
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p $out

              # Copy the compiled WASM and JS files
              cp -r dist/. $out/

              # Copy the official wa-sqlite TypeScript definitions into the output!
              cp src/*.d.ts $out/ 2>/dev/null || true

              runHook postInstall
            '';

            meta = {
              description = "Official SQLite WASM build with custom overlay";
              homepage = "https://sqlite.org/wasm";
            };
          };

          # ---------------------------------------------------------------------------
          # Package 2: wa-sqlite build
          # ---------------------------------------------------------------------------
          wa-sqlite = pkgs.stdenv.mkDerivation rec {
            pname = "wa-sqlite";
            version = "master";

            src = wa-sqlite-src;

            # 1. The SQLite tarball (Hash is correct!)
            sqliteDependency = pkgs.fetchurl {
              url = "https://www.sqlite.org/src/tarball/version-3.50.1/sqlite.tar.gz";
              hash = "sha256-bFhb3Aofgn167eeI3yFQGnsEm3Uj+DmAZV8aVz5dG+w=";
            };

            # 2. The newly discovered dependency (Fake hash - you need to grab the real one)
            extFunctionsDependency = pkgs.fetchurl {
              url = "https://www.sqlite.org/contrib/download/extension-functions.c?get=25";
              hash = "sha256-mRtA/osnme3CFfcmC4kPFKgzUSydmJaqCAiRMw/+QFI=";
            };

            # 3. Add openssl so the Makefile can verify the hash
            nativeBuildInputs = commonBuildInputs ++ [ pkgs.openssl ];

            postUnpack = ''
              # Apply overlay files
              shopt -s dotglob
              cp -r --no-preserve=mode ${self}/overlay.wa-sqlite/. source/ || true
            '';

            # 4. A smarter fake curl that respects the `-o` flag and checks the URL
            postPatch = ''
              mkdir -p .nix-fake-bin
              cat << EOF > .nix-fake-bin/curl
              #!/usr/bin/env bash
              OUTFILE="/dev/stdout"
              URL=""

              # Check which file the Makefile is asking for
              for arg in "\$@"; do
                case "\$arg" in
                  *sqlite.tar.gz*) URL="sqlite" ;;
                  *extension-functions.c*) URL="ext" ;;
                esac
              done

              # Capture the output file if the -o flag is used
              while [ \$# -gt 0 ]; do
                if [ "\$1" = "-o" ]; then
                  OUTFILE="\$2"
                fi
                shift
              done

              # Route the correct Nix store file to the requested destination
              if [ "\$URL" = "sqlite" ]; then
                cat ${sqliteDependency} > "\$OUTFILE"
              elif [ "\$URL" = "ext" ]; then
                cat ${extFunctionsDependency} > "\$OUTFILE"
              fi
              EOF
              chmod +x .nix-fake-bin/curl
            '';

            configurePhase = ''
              runHook preConfigure
              export EM_CACHE=$TMPDIR/emscripten-cache
              mkdir -p $EM_CACHE
              runHook postConfigure
            '';

            buildPhase = ''
              runHook preBuild
              export PATH="$PWD/.nix-fake-bin:$PATH"
              export EMCC_CFLAGS="-fexceptions -g"
              make
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -r dist/. $out/

              # Replace import.meta.url with a bundler-safe alternative
              find $out -name '*.js' -o -name '*.mjs' | xargs sed -i 's/import\.meta\.url/undefined/g'

              runHook postInstall
            '';

            meta = {
              description = "wa-sqlite WASM build with custom overlay";
              homepage = "https://github.com/rhashimoto/wa-sqlite";
            };
          };

        };

        # Default build is wa-sqlite
        packages.default = self.packages.${system}.wa-sqlite;

        # Dev shell with all build tools available for local iteration
        devShells.default = pkgs.mkShell {
          name = "sqwab-dev";
          buildInputs = commonBuildInputs ++ (with pkgs; [
            autoconf
            automake
            libtool
            tcl
            curl
            git
          ]);
          shellHook = ''
            export EM_CACHE=$TMPDIR/emscripten-cache
            mkdir -p $EM_CACHE
            echo "sqwab dev shell ready."
            echo "  emcc version: $(emcc --version | head -1)"
          '';
        };
      }
    );
}
