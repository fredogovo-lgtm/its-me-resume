; Only normal removal needs this guard. Keep electron-builder's transactional
; --updated file moves and rollback intact. Never touch app data or schedule a
; reboot deletion: failure must leave a usable uninstall entry for a retry.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    Push $R0
    StrCpy $R0 0
    itsme_remove_main_retry:
      ClearErrors
      Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 itsme_remove_main_done
      IntOp $R0 $R0 + 1
      IntCmp $R0 40 itsme_remove_main_failed 0 itsme_remove_main_failed
      Sleep 250
      Goto itsme_remove_main_retry
    itsme_remove_main_failed:
      Pop $R0
      DetailPrint "ITS ME main executable cannot be removed; other installed files are intact."
      IfSilent itsme_remove_main_quit
      MessageBox MB_OK|MB_ICONEXCLAMATION "无法卸载：主程序文件暂时无法删除。请关闭 ITS ME 后重试，或重启电脑后再卸载。您的资料未被删除。"
    itsme_remove_main_quit:
      SetErrorLevel 2
      Quit
    itsme_remove_main_done:
      ClearErrors
      Pop $R0
  ${EndIf}
!macroend
