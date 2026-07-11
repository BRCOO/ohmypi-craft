; electron-builder NSIS hook. The bundled OMP runtime is copied through
; extraResources, so remove it explicitly during uninstall instead of relying
; on the default application-file manifest.
!macro customUnInstall
  RMDir /r "$INSTDIR\resources\omp"
!macroend
