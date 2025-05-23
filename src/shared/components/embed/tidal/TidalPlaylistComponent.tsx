interface TidalPlaylistComponentProps {
  match: string
}

function TidalPlaylistComponent({match}: TidalPlaylistComponentProps) {
  return (
    <iframe
      scrolling="no"
      width="650"
      height="200"
      style={{maxWidth: "100%"}}
      src={`https://embed.tidal.com/playlists/${match}?layout=gridify`}
      frameBorder="0"
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  )
}

export default TidalPlaylistComponent
