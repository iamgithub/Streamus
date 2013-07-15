//  Responsible for showing options when interacting with a Playlist in Playlist_List.
define(['contextMenu'], function (contextMenu) {
    'use strict';
    
    var playlistContextMenu = $.extend({}, contextMenu, {
        
        initialize: function (playlist) {
            this.remove();

            this.addContextMenuItem({
                text: 'Copy URL',
                click: function () {
                  
                    playlist.getShareCode(function (shareCode) {

                        var shareCodeShortId = shareCode.get('shortId');
                        var urlFriendlyEntityTitle = shareCode.get('urlFriendlyEntityTitle');

                        var playlistShareUrl = 'http://share.streamus.com/playlist/' + shareCodeShortId + '/' + urlFriendlyEntityTitle;

                        chrome.extension.sendMessage({
                            method: 'copy',
                            text: playlistShareUrl
                        });
                    
                    });
                    
                }
            });

            //  Don't allow deleting of the last playlist in a stream ( at least for now )
            var isDeleteDisabled = playlist.get('nextPlaylistId') === playlist.get('id');

            this.addContextMenuItem({
                text: 'Delete playlist',
                disabled: isDeleteDisabled,
                title: isDeleteDisabled ? 'This is your last Playlist, so you can\'t delete it' : '',
                click: function () {

                    var isDisabled = $(this).attr('disabled');

                    if (!isDisabled) {
                        playlist.destroy({
                            error: function (error) {
                                console.error(error);
                            }
                        });
                    }

                }
            });

        }
    });

    return playlistContextMenu;
});