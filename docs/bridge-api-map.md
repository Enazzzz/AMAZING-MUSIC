# Bridge API Map

Generated from static analysis of `exported/app.js`.

## Static execute(...) Namespace Methods

### Library

- Library.addPlaylistToLibraryByAsin
- Library.addToLibrary
- Library.addToSearchHistory
- Library.appendTracksToPlaylist
- Library.applyFilter
- Library.artistFollow
- Library.changeKeyword
- Library.changePageOffset
- Library.changePageSort
- Library.changePlaylistVisibility
- Library.clearSearchHistory
- Library.createPlaylist
- Library.deleteFromLibrary
- Library.getAlbum
- Library.getAlbumBrowsePage
- Library.getArtist
- Library.getArtistBrowsePage
- Library.getDownloadQueue
- Library.getInstantResults
- Library.getPlaylistBrowsePage
- Library.getPlaylistDetail
- Library.getPlaylists
- Library.getSearchResults
- Library.getSongBrowsePage
- Library.moveTracksInPlaylist
- Library.querySelection
- Library.randomizePlaylist
- Library.release
- Library.removePlaylists
- Library.removeTracksFromPlaylist
- Library.renamePlaylist
- Library.sharePlaylist

### Media

- Media.addFolders
- Media.editMetadata
- Media.getAvailableMediaPlayers
- Media.getCatalogMetadata
- Media.getCommonMetadata
- Media.getExternalMusicSources
- Media.removeFolders
- Media.scanLocalMedia

### User

- none detected

### Playback

- none detected

### Player

- Player.appendTracks
- Player.disableIsAutoplayStarting
- Player.dismissAutoplayNotification
- Player.getNextResponse
- Player.initiateQueueResponse
- Player.insertNext
- Player.playNext
- Player.playPrevious
- Player.rateCqEntity
- Player.rateEntity
- Player.registerCqConnect
- Player.registerGetNext
- Player.registerInitiateQueue
- Player.registerSendNextUpdate
- Player.removeFromPlayQueue
- Player.reorderPlayables
- Player.resumeAndTerminateRemoteStream
- Player.seek
- Player.setAudioQuality
- Player.setExclusiveMode
- Player.setOutputDevice
- Player.setPaused
- Player.setShowExclusiveMode
- Player.setShuffle
- Player.setTempo
- Player.setVolume
- Player.startCollectionPlayback
- Player.startPlayback
- Player.startPodcastPlayback
- Player.startSFAPlayback
- Player.stopPlayback
- Player.toggleAutoplay
- Player.toggleLoudnessNormalization
- Player.toggleMute
- Player.toggleRepeat
- Player.updateProcessed

## Targeted Discovery Notes

- Album art URL size params detected: yes
- Rating calls detected: rateCqEntity, rateEntity
- EQ or DSP-related calls detected: Player.initiateQueueResponse, Player.registerInitiateQueue

## TODO Probes

- Probe `Library.getPlaylistBrowsePage` and `Library.changePageOffset` for full playlist track list pagination.
- Probe album art URL rewriting patterns (`._SX400_`, `._UX400_`) and force highest stable size.
- Probe `Player.rateEntity` argument shape from runtime intercept logs (entity id, direction, context).
- Probe EQ/DSP bridge names by runtime intercept during settings interactions.
- Validate whether `User.*` or `Playback.*` execute calls are hidden behind dynamic command strings.

