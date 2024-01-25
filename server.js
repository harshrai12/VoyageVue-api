const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;


mongoose.connect(process.env.MONGODB_URI ,
{ useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;

const storage = multer.memoryStorage(); // Use memory storage for storing files as Buffer
const upload = multer({ storage: storage });

db.once('open', () => {
  console.log('Connected to MongoDB');
});

db.on('error', (err) => {
  console.error(`MongoDB connection error: ${err}`);
});

app.use(bodyParser.json());

const userSchema = new mongoose.Schema({
  email: String,
  Fullname: String,
  bio: String,
  password: String,
  profileImage: String, // Store the image as Base64-encoded string
  posts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DiaryPost' }], // Array of DiaryPost references
  bookedTrips: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trip' }], // Array of Trip references
});

const User = mongoose.model('User', userSchema);


const tripSchema = new mongoose.Schema({
  destination: String,
  date: Date,
  description: String,
  price: String,
  // Add other fields as needed
});

const Trip = mongoose.model('Trip', tripSchema);

const diaryPostSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  destination: String,
  date: Date,
  description: String,
  itinerary: String,
  image: String, // Store the image as Base64-encoded string
  visibility: String,
});

const DiaryPost = mongoose.model('DiaryPost', diaryPostSchema);



app.post('/register', upload.single('profileImage'), async (req, res) => {
  const { email, Fullname, bio, password } = req.body;
  const profileImageBuffer = req.file.buffer;
  const profileImageBase64 = profileImageBuffer.toString('base64'); // Convert the buffer to Base64

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      email,
      Fullname,
      bio,
      password: hashedPassword, // Store the hashed password
      profileImage: profileImageBase64, // Store the Base64 string
    });

    await user.save();
    io.emit('newRegistration', { user: Fullname });
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error registering user' });
  }
});

const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    
   
    const decoded = jwt.verify(token, 'your-secret-key'); // Replace with your own secret key
    console.log("decoded",decoded)
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}


app.post('/login', async (req, res) => {
  const { email, password } = req.body;
   
  try {
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, 'your-secret-key', { expiresIn: '1h' }); // Replace with your own secret key
    console.log("login",token)
    res.status(200).json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Error authenticating user' });
  }
});


app.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error fetching user data' });
  }
});



// Endpoint to get recent activity data
app.get('/recent-activity', async (req, res) => {
  try {
    // Fetch user data with booked trips from the database
    const usersWithBookedTrips = await User.find({}).populate('bookedTrips');

    // Transform the data to include user names and booked trip details
    const recentActivityData = usersWithBookedTrips.map(user => {
      const userName = user.Fullname;
      const bookedTrips = user.bookedTrips.map(trip => {
        return {
          destination: trip.destination,
          date: trip.date,
          description: trip.description,
          // Add other trip details as needed
        };
      });

      return { user: userName, trips: bookedTrips };
    });

    res.json(recentActivityData);
  } catch (error) {
    console.error('Error fetching recent activity data:', error);
    res.status(500).json({ error: 'Error fetching recent activity data' });
  }
});





app.get('/profile', authenticateUser, async (req, res) => {
  try {
    // Retrieve the user data using the userId from the token
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
 // Retrieve the diary posts made by the specific user
 const userPosts = await DiaryPost.find({ user: req.userId });
    // Return the user data excluding the password
    const { email, Fullname, bio, profileImage } = user;
    res.status(200).json({ email, Fullname, bio, profileImage, posts: userPosts });
  } catch (error) {0
    console.error('Error:', error);
    res.status(500).json({ error: 'Error fetching user data' });
  }
});

app.post('/diary-posts', authenticateUser, upload.single('image'), async (req, res) => {
  const { destination, date, description, itinerary, visibility } = req.body;
  const imageBuffer = req.file.buffer;
  const imageBase64 = imageBuffer.toString('base64');

  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const diaryPost = new DiaryPost({
      user: req.userId,
      destination,
      date,
      description,
      itinerary,
      image: imageBase64,
      visibility,
    });

    await diaryPost.save();
    user.posts.push(diaryPost._id);
    await user.save();
    
    res.status(201).json({ message: 'Diary post created successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error creating diary post' });
  }
});

app.post('/book-trip', authenticateUser, async (req, res) => {
  try {
    const { trip } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { destination, date, description, price } = trip;
    const bookedTrip = new Trip({ destination, date, description, price });

    await bookedTrip.save();

    // Log the bookedTrip._id for debugging
    console.log('Booked Trip ID:', bookedTrip._id);

    // Update the user's bookedTrips
    user.bookedTrips.push(bookedTrip._id);
    await user.save();

    // Log the user document for debugging
    console.log('Updated User:', user);

    res.json({ success: true, user });
  } catch (error) {
    console.error('Error booking trip:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});






// Add this route to get all user posts
app.get('/users-posts', async (req, res) => {
  try {
    // Fetch all diary posts from the database and populate the user information
    const diaryPosts = await DiaryPost.find()
      .populate('user', 'Fullname profileImage');

    // Send the diary posts as a JSON response
    res.status(200).json(diaryPosts);
  } catch (error) {
    console.error('Error fetching user posts:', error);
    res.status(500).json({ error: 'Error fetching user posts' });
  }
});

// Import necessary modules at the top of your existing server code
 // Middleware to check admin status
 // Add the isAdmin middleware
const isAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, 'your-secret-key'); // Replace with your own secret key

    const user = await User.findById(decoded.userId);

    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};


// Add a new route for the admin dashboard
app.get('/admin/dashboard', async (req, res) => {
  try {
    // Fetch all users and their posts from the database
    const usersWithPosts = await User.find().populate('posts');

    // Transform the data to include user IDs and post IDs
    const transformedData = usersWithPosts.map(user => {
      return {
        _id: user._id, // Include the user ID
        Fullname: user.Fullname,
        email: user.email,
        profileImage: user.profileImage,

        posts: user.posts.map(post => {
          return {
            _id: post._id, // Include the post ID
            destination: post.destination,
            date: post.date,
            description: post.description,
            itinerary: post.itinerary,
            visibility: post.visibility,
          };
        }),
      };
    });

    // Send the data as a JSON response
    res.status(200).json(transformedData);
  } catch (error) {
    console.error('Error fetching admin dashboard data:', error);
    res.status(500).json({ error: 'Error fetching admin dashboard data' });
  }
});



app.delete('/admin/deletePost', async (req, res) => {
  const { userId, postId } = req.body;

  try {
    // Find the user by ID
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove the post from the user's posts array
    user.posts.pull(postId);
    await user.save();

    // Delete the post
    await DiaryPost.findByIdAndDelete(postId);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.delete('/admin/deleteUser', async (req, res) => {
  const { userId } = req.body;

  try {
    // Find the user by ID and delete it
    await User.findByIdAndDelete(userId);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Error deleting user' });
  }
});




app.use('/uploads', express.static('uploads'));

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
