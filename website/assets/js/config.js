/*
 * Everything you may want to change about the website lives here.
 *
 * CONTACT: fill these in and the phone, email, WhatsApp button and map appear on the site.
 * Leave a value empty ("") to hide it.
 *
 * MEDIA: the photos and videos are free stock (Pexels licence) standing in until Triumph's own
 * footage is ready. To use your own, put the files in /assets/media/ and change the paths below,
 * e.g. video: "/assets/media/our-warehouse.mp4". Keep videos short (10–30 s), 1280–1920 px wide,
 * under ~8 MB, without sound.
 */
window.TRIUMPH = {
  contact: {
    phone: "", // e.g. "+255 712 345 678"
    whatsapp: "", // digits only with country code, e.g. "255712345678"
    email: "", // e.g. "info@triumphsuppliers.co.tz"
    address: "", // e.g. "Plot 12, Nyerere Road, Dar es Salaam"
    hours: "Mon – Sat, 8:00 – 17:30 (EAT)",
    mapQuery: "", // e.g. "Nyerere Road, Dar es Salaam" (shows a map in the Contact section)
    linkedin: "",
    instagram: "",
    facebook: "",
  },

  media: {
    hero: {
      video: "https://videos.pexels.com/video-files/6595369/6595369-uhd_2560_1440_24fps.mp4",
      poster: "https://images.pexels.com/videos/6595369/pexels-photo-6595369.jpeg?auto=compress&cs=tinysrgb&w=1600",
    },
    reel: [
      {
        title: "Warehousing & dispatch",
        note: "Stock picked, packed and loaded",
        video: "https://videos.pexels.com/video-files/6079421/6079421-uhd_2560_1440_24fps.mp4",
        poster: "https://images.pexels.com/videos/6079421/pexels-photo-6079421.jpeg?auto=compress&cs=tinysrgb&w=1400",
      },
      {
        title: "Supplying the mines",
        note: "Spares, lubricants and PPE on site",
        video: "https://videos.pexels.com/video-files/35650013/15107628_1920_1080_50fps.mp4",
        poster: "https://images.pexels.com/videos/35650013/pexels-photo-35650013.jpeg?auto=compress&cs=tinysrgb&w=900",
      },
      {
        title: "Oil & gas support",
        note: "Chemicals and lubricants for plants",
        video: "https://videos.pexels.com/video-files/10396407/10396407-hd_2560_1440_30fps.mp4",
        poster: "https://images.pexels.com/videos/10396407/business-chemical-energy-fuel-10396407.jpeg?auto=compress&cs=tinysrgb&w=900",
      },
    ],
  },

  /* Photos used across the site (the key is used in the HTML as data-img="key"). */
  img: {
    drums: "https://images.pexels.com/photos/38150961/pexels-photo-38150961.jpeg",
    drumsBlue: "https://images.pexels.com/photos/615670/pexels-photo-615670.jpeg",
    chemicals: "https://images.pexels.com/photos/2786527/pexels-photo-2786527.jpeg",
    containers: "https://images.pexels.com/photos/13572281/pexels-photo-13572281.jpeg",
    bearings: "https://images.pexels.com/photos/39994422/pexels-photo-39994422.jpeg",
    gears: "https://images.pexels.com/photos/39315863/pexels-photo-39315863.jpeg",
    spares: "https://images.pexels.com/photos/7568421/pexels-photo-7568421.jpeg",
    ppe: "https://images.pexels.com/photos/33914927/pexels-photo-33914927.jpeg",
    helmet: "https://images.pexels.com/photos/34965713/pexels-photo-34965713.jpeg",
    mining: "https://images.pexels.com/photos/28442180/pexels-photo-28442180.jpeg",
    mine2: "https://images.pexels.com/photos/15071423/pexels-photo-15071423.jpeg",
    sugar: "https://images.pexels.com/photos/7457175/pexels-photo-7457175.jpeg",
    cement: "https://images.pexels.com/photos/18468425/pexels-photo-18468425.jpeg",
    cementNight: "https://images.pexels.com/photos/29590119/pexels-photo-29590119.jpeg",
    refinery: "https://images.pexels.com/photos/38343896/pexels-photo-38343896.jpeg",
    tanks: "https://images.pexels.com/photos/31403876/pexels-photo-31403876.jpeg",
    warehouse: "https://images.pexels.com/photos/4487383/pexels-photo-4487383.jpeg",
    shelves: "https://images.pexels.com/photos/30341205/pexels-photo-30341205.jpeg",
    truck: "https://images.pexels.com/photos/18885403/pexels-photo-18885403.jpeg",
    trailer: "https://images.pexels.com/photos/5410923/pexels-photo-5410923.jpeg",
    handshake: "https://images.pexels.com/photos/33175650/pexels-photo-33175650.jpeg",
    worker: "https://images.pexels.com/photos/14875937/pexels-photo-14875937.jpeg",
    engineer: "https://images.pexels.com/photos/11174191/pexels-photo-11174191.jpeg",
    mechanic: "https://images.pexels.com/photos/28153670/pexels-photo-28153670.jpeg",
  },
};
