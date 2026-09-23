{ pkgs, ... }: {
  # Firebase Studio (firebase.studio) environment for Optimizer V.4.0.
  #
  # The dashboard is a plain static site: index.html + src/*.js|*.css|*.png, with no
  # build step. Node is only here so the preview server and the Firebase CLI can run.
  channel = "stable-24.05";

  packages = [
    pkgs.nodejs_20
    pkgs.bashInteractive
    pkgs.zip
  ];

  idx = {
    extensions = [];

    previews = {
      enable = true;
      previews = {
        web = {
          # serves the repo root, so https://<preview>/ loads index.html
          command = [ "npx" "--yes" "serve@14" "--no-clipboard" "-l" "$PORT" "." ];
          manager = "web";
        };
      };
    };

    workspace = {
      onCreate = {
        default.openFiles = [ "index.html" "README-FIREBASE.md" ];
      };
    };
  };
}
