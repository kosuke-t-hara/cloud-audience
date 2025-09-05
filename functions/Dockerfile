# Use an official Node.js runtime as a parent image
FROM node:22-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Your app binds to 8080 by default in Cloud Run
ENV PORT=8080
EXPOSE 8080

# Define the command to run your app
CMD ["npm", "start"]
